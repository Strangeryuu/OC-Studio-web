#!/usr/bin/env bash
# Offline deployment backup acceptance test; no Docker daemon or live DB needed.
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test_root="$(mktemp -d)"
trap 'rm -rf -- "$test_root"' EXIT
mkdir -p "$test_root/deploy/data/media" "$test_root/bin"
cp "$repo_root/deploy/backup.sh" "$test_root/deploy/backup.sh"
touch "$test_root/deploy/.env" "$test_root/deploy/compose.yaml"
printf 'private test image\n' > "$test_root/deploy/data/media/image.txt"

cat > "$test_root/bin/docker" <<'MOCK'
#!/usr/bin/env bash
set -Eeuo pipefail
if [[ " $* " == *" up -d --wait db"* ]]; then
  exit 0
fi
if [[ " $* " == *" pg_dump "* ]]; then
  if [[ "${FAIL_DB_DUMP:-}" == "1" ]]; then exit 42; fi
  printf 'mock database archive\n'
  exit 0
fi
if [[ " $* " == *" pg_restore --list"* ]]; then
  if [[ "${FAIL_DUMP_VERIFY:-}" == "1" ]]; then exit 43; fi
  IFS= read -r data
  [[ "$data" == "mock database archive" ]]
  exit 0
fi
printf 'Unexpected docker call: %s\n' "$*" >&2
exit 44
MOCK
chmod 755 "$test_root/bin/docker"
export PATH="$test_root/bin:$PATH"
cd "$test_root/deploy"

bash ./backup.sh
mapfile -t dirs < <(find backups -mindepth 1 -maxdepth 1 -type d ! -name '.staging.*')
[[ "${#dirs[@]}" == 1 ]] || { echo 'Expected exactly one completed backup' >&2; exit 1; }
backup="${dirs[0]}"
[[ -s "$backup/postgres.dump" && -s "$backup/media.tgz" && -s "$backup/SHA256SUMS" ]]
(cd "$backup" && sha256sum -c --quiet SHA256SUMS)
[[ "$(tar -xOzf "$backup/media.tgz" media/image.txt)" == 'private test image' ]]
[[ "$(stat -c %a "$backup/postgres.dump")" == 600 ]]

if FAIL_DB_DUMP=1 bash ./backup.sh > /dev/null 2>&1; then
  echo 'Backup succeeded despite a failing PostgreSQL dump' >&2
  exit 1
fi
if FAIL_DUMP_VERIFY=1 bash ./backup.sh > /dev/null 2>&1; then
  echo 'Backup succeeded despite a failing archive verification' >&2
  exit 1
fi
mapfile -t final_dirs < <(find backups -mindepth 1 -maxdepth 1 -type d ! -name '.staging.*')
[[ "${#final_dirs[@]}" == 1 ]] || { echo 'Published partial backup after failure' >&2; exit 1; }
if find backups -maxdepth 1 -name '.staging.*' | grep -q .; then
  echo 'Left an incomplete backup staging directory' >&2
  exit 1
fi
echo 'Atomic deploy backup acceptance passed.'

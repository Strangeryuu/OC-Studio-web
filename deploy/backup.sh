#!/usr/bin/env bash
# Create an integrity-checked PostgreSQL + media backup for the same deployment.
# Run manually, or from update.sh before applying migrations.
set -Eeuo pipefail
umask 077
cd "$(dirname "${BASH_SOURCE[0]}")"

if [[ ! -f .env || ! -f compose.yaml ]]; then
  echo "Missing deployment .env or compose.yaml." >&2
  exit 1
fi
if [[ ! -d data/media ]]; then
  echo "Missing data/media; check the persistent media mount." >&2
  exit 1
fi

# A manual backup must never race a deployment migration. update.sh holds
# .update.lock itself and explicitly sets the internal bypass for its child.
if [[ "${OCSTUDIO_UPDATE_IN_PROGRESS:-}" != "1" ]]; then
  exec 8>.update.lock
  if ! flock -n 8; then
    echo "A deployment is running; retry the backup afterwards." >&2
    exit 1
  fi
fi
exec 9>.backup.lock
if ! flock -n 9; then
  echo "Another backup is already running." >&2
  exit 1
fi

compose=(docker compose --env-file .env -f compose.yaml)
"${compose[@]}" up -d db

mkdir -p backups
stamp="$(date -u +%Y%m%dT%H%M%SZ)-$$"
destination="backups/$stamp"
stage="$(mktemp -d backups/.staging.XXXXXXXX)"
trap 'if [[ -n "${stage:-}" && -d "$stage" ]]; then rm -rf -- "$stage"; fi' EXIT

echo "Creating PostgreSQL backup..."
"${compose[@]}" exec -T db sh -ec 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$stage/postgres.dump"
[[ -s "$stage/postgres.dump" ]] || { echo "PostgreSQL dump is empty." >&2; exit 1; }

# Check the actual archive format using the matching PostgreSQL container.
"${compose[@]}" exec -T db pg_restore --list < "$stage/postgres.dump" > /dev/null

echo "Archiving private media..."
tar -czf "$stage/media.tgz" -C data media
tar -tzf "$stage/media.tgz" > /dev/null
(
  cd "$stage"
  sha256sum postgres.dump media.tgz > SHA256SUMS
  sha256sum -c --quiet SHA256SUMS
)
printf '%s\n' "Created UTC: $(date -u +%Y-%m-%dT%H:%M:%SZ)"   "Contents: postgres.dump, media.tgz"   "Restore both files together in a maintenance window." > "$stage/README.txt"

# One final rename publishes the verified pair. Partial backups are removed.
mv -- "$stage" "$destination"
stage=""
echo "Verified OC Studio backup: $(pwd)/$destination"
echo "Copy this directory to encrypted offsite storage; regularly test restoration."

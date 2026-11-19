#!/usr/bin/env bash
# Deploy a verified :dev image (or a pinned sha-* image) from GHCR.
# Only runs schema migrations when the Web image changes or is unhealthy.
set -Eeuo pipefail
umask 077
cd "$(dirname "${BASH_SOURCE[0]}")"

if [[ ! -f .env ]]; then
  echo "Missing $(pwd)/.env; copy .env.example and configure production secrets." >&2
  exit 1
fi
if [[ ! -d data/media ]]; then
  echo "Create data/media and grant UID/GID 10001 ownership before starting." >&2
  exit 1
fi
# Scheduled backups are written by the non-root web service (UID 10001).
mkdir -p data/scheduled-backups
if [[ "$(stat -c '%u' data/scheduled-backups)" != '10001' ]]; then
  chown 10001:10001 data/scheduled-backups || {
    echo "Run: sudo chown -R 10001:10001 $(pwd)/data/scheduled-backups" >&2
    exit 1
  }
fi
chmod 700 data/scheduled-backups

# Serializes systemd timer executions and manual invocations.
exec 9>.update.lock
if ! flock -n 9; then
  echo "Another deployment is already running; skipping."
  exit 0
fi

compose=(docker compose --env-file .env -f compose.yaml)
if [[ -f compose.mail.yaml ]]; then
  # Optional local Sendmail relay. Fail before migrations if the non-root
  # Web container cannot read its confidential host-mounted mail files.
  for mail_file in mail/msmtprc mail/smtp-password; do
    if [[ ! -f "$mail_file" ]]; then
      echo "Mail relay configuration is missing: $mail_file" >&2
      exit 1
    fi
    if [[ "$(stat -c '%u:%a' "$mail_file")" != '10001:600' ]]; then
      echo "Expected UID 10001 and mode 600 on $mail_file (chown 10001:10001; chmod 600)." >&2
      exit 1
    fi
  done
  compose+=(-f compose.mail.yaml)
fi
echo "Pulling verified OC Studio app and migration images..."
"${compose[@]}" --profile maintenance pull migrate web

web_image="$("${compose[@]}" config --images | grep -E '^ghcr\.io/[^/]+/oc-studio-web:[^[:space:]]+$' | head -n 1)"
if [[ -z "$web_image" ]]; then
  echo "Cannot resolve Web image from Compose configuration." >&2
  exit 1
fi
wanted_id="$(docker image inspect --format '{{.Id}}' "$web_image")"
running_cid="$("${compose[@]}" ps -q web)"
running_id=''
running_health=''
if [[ -n "$running_cid" ]]; then
  running_id="$(docker inspect --format '{{.Image}}' "$running_cid" 2>/dev/null || true)"
  running_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$running_cid" 2>/dev/null || true)"
fi

if [[ -n "$running_id" && "$running_id" == "$wanted_id" && "$running_health" == "healthy" ]]; then
  # Compose will recreate the Web container only if its configuration
  # changed (for example, when the optional Sendmail relay is enabled).
  "${compose[@]}" up -d --no-deps --wait web
  "${compose[@]}" up -d --no-deps backup-worker
  echo "Web image is running and healthy ($web_image); Compose configuration checked."
  exit 0
fi

"${compose[@]}" up -d db

# Back up even if the Web container is absent: the PostgreSQL volume may hold
# valuable existing data after a stopped/failed deployment.
# This child shares the caller's update lock while holding its backup lock.
echo "Backing up PostgreSQL and private media before updating..."
OCSTUDIO_UPDATE_IN_PROGRESS=1 bash ./backup.sh

echo "Applying Better Auth and business database migrations..."
"${compose[@]}" --profile maintenance run --rm migrate

echo "Starting the new standalone Web image..."
"${compose[@]}" up -d --no-deps web

# An unhealthy deployment reports an error; preserve both backups and logs
# for inspection rather than attempting a DB-incompatible automatic rollback.
cid="$("${compose[@]}" ps -q web)"
if [[ -z "$cid" ]]; then
  echo "Web container was not created; inspect docker compose logs web." >&2
  exit 1
fi
for _ in $(seq 1 30); do
  status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || true)"
  if [[ "$status" == "healthy" ]]; then
    "${compose[@]}" up -d --no-deps backup-worker
    echo "OC Studio deployment is healthy ($web_image)."
    exit 0
  fi
  if [[ "$status" == "unhealthy" || "$status" == "exited" ]]; then
    echo "Web container status: $status. Inspect docker compose logs web." >&2
    exit 1
  fi
  sleep 2
done
echo "Timed out waiting for the OC Studio health check; inspect docker compose logs web." >&2
exit 1

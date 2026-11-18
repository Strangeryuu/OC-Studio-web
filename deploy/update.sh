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

# Serializes systemd timer executions and manual invocations.
exec 9>.update.lock
if ! flock -n 9; then
  echo "Another deployment is already running; skipping."
  exit 0
fi

compose=(docker compose --env-file .env -f compose.yaml)
echo "Pulling verified OC Studio app and migration images..."
"${compose[@]}" pull migrate web

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
  echo "Web image is already running and healthy ($web_image); no deployment needed."
  exit 0
fi

"${compose[@]}" up -d db

if [[ -n "$running_id" ]]; then
  # Back up both sources of persistent data before applying DB migrations.
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p backups
  echo "Backing up PostgreSQL and private media before updating..."
  "${compose[@]}" exec -T db sh -ec 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "backups/postgres-$stamp.dump"
  tar -czf "backups/media-$stamp.tgz" -C data media
fi

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

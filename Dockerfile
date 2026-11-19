# syntax=docker/dockerfile:1.7
# Production OCI images: slim Next.js standalone app + separate schema migrator.
FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json .npmrc ./
RUN npm ci --no-audit --no-fund

FROM dependencies AS builder
COPY . .
RUN npm run build:web

FROM node:24-bookworm-slim AS web
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    HOME=/home/ocstudio \
    MEDIA_ROOT=/data/media
# msmtp-mta provides /usr/sbin/sendmail. It forwards mail via a configured
# authenticated SMTP relay; see deploy/compose.mail.yaml (opt-in) and docs.
# Keep only the sendmail-compatible client in the Web image, not a mail daemon.
RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      ca-certificates msmtp-mta && \
    rm -rf /var/lib/apt/lists/* && \
    test -x /usr/sbin/sendmail && \
    groupadd --system --gid 10001 ocstudio && \
    useradd --system --uid 10001 --gid 10001 --home-dir /home/ocstudio --create-home ocstudio && \
    chmod 700 /home/ocstudio && \
    mkdir -p /data/media && chown -R 10001:10001 /data
COPY --from=builder --chown=10001:10001 /app/.next/standalone ./
COPY --from=builder --chown=10001:10001 /app/.next/static ./.next/static
COPY --from=builder --chown=10001:10001 /app/public ./public
LABEL org.opencontainers.image.source="https://github.com/Strangeryuu/OC-Studio-web"
USER 10001:10001
EXPOSE 3000
CMD ["node", "server.js"]

# Better Auth CLI is a development dependency. Keep it in a separate image
# instead of shipping all build tools and application source in the Web image.
FROM dependencies AS migrate
COPY . .
LABEL org.opencontainers.image.source="https://github.com/Strangeryuu/OC-Studio-web"
CMD ["sh", "-ec", "npx --no-install auth migrate --yes --config ./src/lib/cloud/server/auth.ts && node scripts/cloud-migrate-business.cjs && node scripts/cloud-db-smoke.cjs"]

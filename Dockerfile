# OC Studio Cloud. Build requires a synchronized package-lock.json.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Build-only placeholders. Production credentials are injected at runtime.
ENV BETTER_AUTH_SECRET=build-only-placeholder-secret-please-replace-in-production
ENV BETTER_AUTH_URL=http://localhost:3000
ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/ocstudio
RUN npm run build:web

FROM deps AS migrate
COPY . .

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
RUN mkdir -p /data/media && chown -R node:node /data/media
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]

# Production image: one persistent Node process (see README, "Cache e operação").
# Debian slim instead of Alpine so sharp uses its prebuilt glibc binaries.

FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    TSE_CACHE_DIR=/app/.cache/tse

COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
# Read from disk at runtime (src/lib/tse/municipal-baseline.ts), not bundled.
COPY --from=build --chown=node:node /app/data/tse ./data/tse

# Writable, persistent state: TSE snapshots/history and, without DATABASE_URL, the JSON stores.
RUN mkdir -p .cache/tse .data && chown -R node:node .cache .data
VOLUME ["/app/.cache", "/app/.data"]

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]

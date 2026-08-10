# SpeechBridge — production image
#
# Multi-stage so the runtime image carries no build toolchain and no dev dependencies.
# Built remotely by Azure Container Registry (`azd` uses ACR build), so nobody deploying
# this needs Docker installed locally.

# ---- build ----------------------------------------------------------------
FROM mcr.microsoft.com/devcontainers/javascript-node:1-20-bookworm AS build

WORKDIR /app

# Install with the lockfile first so the layer caches across source-only changes.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.server.json vite.config.ts ./
COPY src ./src
RUN npm run build

# Drop dev dependencies from the tree we are about to copy forward.
RUN npm prune --omit=dev

# ---- runtime --------------------------------------------------------------
FROM mcr.microsoft.com/devcontainers/javascript-node:1-20-bookworm AS runtime

ENV NODE_ENV=production
# Container Apps sends traffic to this port; the server reads PORT.
ENV PORT=8080

WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json

# Never run as root.
USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server/index.js"]

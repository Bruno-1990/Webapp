# Build monorepo
FROM node:22-bookworm-slim AS build
WORKDIR /app
# Toolchain para módulos nativos (better-sqlite3): usa binário pré-compilado quando
# disponível, mas garante o fallback de compilação se o download falhar (ex.: VPS
# sem acesso ao cache de prebuilds). Só no build stage — o runtime copia o .node pronto.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
COPY frontend ./frontend
RUN npm ci --workspaces --include-workspace-root 2>/dev/null || npm install --workspaces --include-workspace-root
RUN npm run build -w @webapp/contracts && npm run build -w @webapp/nfe-core && npm run build -w @webapp/excel-export && npm run build -w @webapp/api && npm run build -w @webapp/worker && npm run build -w @webapp/worker-sped-bridge && npm run build -w @webapp/frontend

# API runtime
FROM node:22-bookworm-slim AS api
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/worker/package.json ./apps/worker/package.json
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
EXPOSE 8000
CMD ["node", "apps/api/dist/server.js"]

# Worker runtime
FROM node:22-bookworm-slim AS worker
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/worker/package.json ./apps/worker/package.json
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
CMD ["node", "apps/worker/dist/index.js"]

# TerrainSN — image production all-in-one (API + frontend + admin)
# Optimisée pour Render Blueprint (render.yaml)

# ── Frontend joueur / backoffice ─────────────────────────────────────────────
FROM node:20-bookworm-slim AS frontend-build
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
ENV VITE_API_URL=/api
RUN npm run build

# ── Admin super-admin ────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS admin-build
WORKDIR /build/admin
COPY admin-frontend/package.json admin-frontend/package-lock.json ./
RUN npm ci
COPY admin-frontend/ ./
ENV VITE_API_URL=/api
ENV VITE_BASE=/admin/
RUN npm run build

# ── Dépendances backend (prod) ───────────────────────────────────────────────
FROM node:20-bookworm-slim AS backend-deps
WORKDIR /build/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

# ── Runtime ──────────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3001 \
    DB_PATH=/data/terrainsn.db \
    UPLOAD_ROOT=/data/uploads \
    PUBLIC_DIR=/app/public \
    ADMIN_PUBLIC_DIR=/app/public-admin \
    SKIP_SEED=false \
    WHATSAPP_MOCK=true \
    PAYTECH_MOCK=true \
    PAYMENT_MODE=simulation

RUN apt-get update \
  && apt-get install -y --no-install-recommends wget ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /data/uploads /app/public /app/public-admin /app/backend \
  && chown -R node:node /data /app

COPY --from=backend-deps --chown=node:node /build/backend/node_modules ./backend/node_modules
COPY --chown=node:node backend/ ./backend/
COPY --from=frontend-build --chown=node:node /build/frontend/dist ./public/
COPY --from=admin-build --chown=node:node /build/admin/dist ./public-admin/

USER node
WORKDIR /app/backend
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT:-3001}/health || exit 1

CMD ["node", "index.js"]

# TerrainSN — image production all-in-one (API + joueur + pro + admin)
# Optimisée pour Render Blueprint (render.yaml)

# ── Frontend joueur ──────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS joueur-build
WORKDIR /build/frontend-joueur
COPY frontend-joueur/package.json frontend-joueur/package-lock.json ./
RUN npm ci
COPY frontend-joueur/ ./
COPY shared/ /build/shared/
ENV VITE_API_URL=/api
RUN npm run build

# ── Frontend pro (mono-host sous /pro/) ──────────────────────────────────────
FROM node:20-bookworm-slim AS pro-build
WORKDIR /build/frontend-pro
COPY frontend-pro/package.json frontend-pro/package-lock.json ./
RUN npm ci
COPY frontend-pro/ ./
COPY shared/ /build/shared/
ENV VITE_API_URL=/api
ENV VITE_BASE=/pro/
RUN npm run build

# ── Admin super-admin (legacy) ───────────────────────────────────────────────
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
    PRO_PUBLIC_DIR=/app/public-pro \
    ADMIN_PUBLIC_DIR=/app/public-admin \
    SKIP_SEED=false \
    WHATSAPP_MOCK=false \
    PAYTECH_MOCK=false \
    PAYMENT_MODE=production \
    PAYMENT_PROVIDER=paytech \
    PAYTECH_ENV=prod

RUN apt-get update \
  && apt-get install -y --no-install-recommends wget ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /data/uploads /app/public /app/public-pro /app/public-admin /app/backend \
  && chown -R node:node /data /app

COPY --from=backend-deps --chown=node:node /build/backend/node_modules ./backend/node_modules
COPY --chown=node:node backend/ ./backend/
COPY --from=joueur-build --chown=node:node /build/frontend-joueur/dist ./public/
COPY --from=pro-build --chown=node:node /build/frontend-pro/dist ./public-pro/
COPY --from=admin-build --chown=node:node /build/admin/dist ./public-admin/

USER node
WORKDIR /app/backend
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT:-3001}/health || exit 1

CMD ["node", "index.js"]

FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# API seule — pour l’image complète (front + admin + seed), utiliser le Dockerfile à la racine du monorepo.
FROM node:20-bookworm-slim
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001
ENV DB_PATH=/data/terrainsn.db
ENV UPLOAD_ROOT=/data/uploads

RUN apt-get update \
  && apt-get install -y --no-install-recommends wget ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /data/uploads \
  && chown -R node:node /data /app

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node . .

USER node
EXPOSE 3001
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/health || exit 1

CMD ["node", "index.js"]

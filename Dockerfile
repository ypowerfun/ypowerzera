# Prime Arena — imagem de produção (Next.js + Prisma/SQLite). Veja docs/HOSPEDAGEM.md.
FROM node:22-bookworm-slim AS base
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM base AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
# --chown aqui (e não um chown -R depois) evita duplicar a pasta inteira em outra camada da imagem.
COPY --from=build --chown=node:node /app /app
# /data guarda o banco (volume do docker-compose). O site roda sem privilégios de administrador.
RUN mkdir -p /data/backups && chown -R node:node /data
USER node
EXPOSE 3000
ENTRYPOINT ["sh", "docker-entrypoint.sh"]

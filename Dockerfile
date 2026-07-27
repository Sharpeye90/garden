FROM node:24-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

WORKDIR /app
RUN groupadd --system garden && useradd --system --gid garden garden

COPY --from=build --chown=garden:garden /app/dist ./dist

USER garden
EXPOSE 3000

CMD ["node", "dist/standalone/server.js"]

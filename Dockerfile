FROM node:22-alpine

ENV NODE_ENV=production
EXPOSE 8080/tcp

LABEL maintainer="Mercury Workshop"
LABEL summary="Scramjet Demo Image"
LABEL description="Example application of Scramjet"

WORKDIR /app

RUN corepack enable

COPY ["package.json", "pnpm-lock.yaml", "./"]
RUN pnpm install --frozen-lockfile --prod

COPY --chown=node:node . .
RUN mkdir -p /app/data && chown -R node:node /app

USER node
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
	CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1

CMD ["src/index.js"]

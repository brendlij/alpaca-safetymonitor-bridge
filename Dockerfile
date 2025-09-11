FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 11111/tcp
EXPOSE 32227/udp
ENV ALPACA_PORT=11111 \
    ASCOM_DISCOVERY_PORT=32227 \
    CONFIG_PATH=/app/data/config.json
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${ALPACA_PORT}/healthz || exit 1
USER node
CMD ["node","server.js"]

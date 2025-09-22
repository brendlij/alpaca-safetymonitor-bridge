FROM node:20-alpine

WORKDIR /app

# Install health check tools
RUN apk add --no-cache wget

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Create directories with proper permissions
RUN mkdir -p /app/data /app/logs && \
    chown -R node:node /app && \
    chmod -R 755 /app

# Copy application code
COPY --chown=node:node . .

# Default ports (can be overridden with environment variables)
EXPOSE 8085/tcp
EXPOSE 32227/udp

ENV NODE_ENV=production \
    WEB_PORT=8085 \
    ASCOM_DISCOVERY_PORT=32227 \
    CONFIG_PATH=/app/data/config.json

VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${WEB_PORT}/healthz || exit 1

USER node
CMD ["node","server.js"]

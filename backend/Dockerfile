FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

# Python + uv + MiniMax MCP server (`minimax-coding-plan-mcp`) — provides the
# `understand_image` MCP tool used by vision intents. Installed at build time
# so the first runtime call doesn't pay the package-fetch latency.
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 python3-pip ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    pip3 install --break-system-packages --no-cache-dir uv && \
    uv tool install minimax-coding-plan-mcp

# uv tool installs land in /root/.local/bin
ENV PATH="/root/.local/bin:${PATH}"

COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY src/db/migrations ./dist/db/migrations

EXPOSE 3001
CMD ["node", "dist/index.js"]

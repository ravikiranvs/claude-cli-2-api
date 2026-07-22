# ---- Build stage: compile TypeScript ----
FROM node:20-bookworm-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- Runtime stage ----
FROM node:20-bookworm-slim
WORKDIR /app

# Claude Code CLI — this is the Claude Subprocess the Gateway shells out to per request.
RUN npm install -g @anthropic-ai/claude-code

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

ENV HOME=/home/node \
    GATEWAY_PORT=3000 \
    ADMIN_PORT=3001 \
    HOST=0.0.0.0 \
    DATABASE_PATH=/app/data/gateway.db \
    UPLOADS_DIR=/app/data/uploads

# /app/data holds the SQLite database and uploaded files; $HOME/.claude holds the
# `claude login` OAuth credentials (see docs/adr/0003-claude-auth-via-docker-volume.md).
RUN mkdir -p /app/data "$HOME/.claude" && chown -R node:node /app/data "$HOME/.claude"

USER node

VOLUME ["/home/node/.claude"]

EXPOSE 3000 3001

CMD ["node", "dist/index.js"]

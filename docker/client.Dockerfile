# ============================================
# Team9 Web Client
# ============================================

FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@10.13.1 --activate
WORKDIR /app

# Copy workspace config
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./

# Copy all package.json files for workspace resolution
COPY apps/client/package.json ./apps/client/
COPY apps/server/package.json ./apps/server/
COPY apps/server/apps/gateway/package.json ./apps/server/apps/gateway/
COPY apps/server/apps/im-worker/package.json ./apps/server/apps/im-worker/
COPY apps/server/apps/task-tracker/package.json ./apps/server/apps/task-tracker/
COPY apps/server/libs/auth/package.json ./apps/server/libs/auth/
COPY apps/server/libs/database/package.json ./apps/server/libs/database/
COPY apps/server/libs/shared/package.json ./apps/server/libs/shared/
COPY apps/server/libs/redis/package.json ./apps/server/libs/redis/
COPY apps/server/libs/rabbitmq/package.json ./apps/server/libs/rabbitmq/
COPY apps/server/libs/ai-client/package.json ./apps/server/libs/ai-client/
COPY apps/server/libs/storage/package.json ./apps/server/libs/storage/
COPY apps/server/libs/email/package.json ./apps/server/libs/email/

# Install dependencies (remove enterprise workspace entries since submodule is not needed for client)
RUN sed -i '/enterprise/d' pnpm-workspace.yaml && \
    pnpm install --frozen-lockfile

# Copy source code
COPY apps/client ./apps/client

# Build argument for API URL
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

# Build the app
RUN pnpm --filter @team9/client build

# ============================================
# Stage: Runner with Caddy
# ============================================
FROM caddy:2-alpine

# Copy Caddyfile
COPY docker/Caddyfile.client /etc/caddy/Caddyfile

# Copy built files
COPY --from=builder /app/apps/client/dist /srv

EXPOSE 80

CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile"]

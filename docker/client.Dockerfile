# ============================================
# Team9 Web Client
# ============================================

FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# Copy workspace config
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/client/package.json ./apps/client/

# Install dependencies
RUN pnpm install --frozen-lockfile

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

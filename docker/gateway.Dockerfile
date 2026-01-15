# ============================================
# Team9 Gateway Service
# ============================================
# Build args:
#   EDITION: community (default) or enterprise
#
# Usage:
#   docker build -f docker/gateway.Dockerfile -t team9-gateway .
#   docker build -f docker/gateway.Dockerfile --build-arg EDITION=enterprise -t team9-gateway:enterprise .
# ============================================

FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
RUN apk add --no-cache libc6-compat

# ============================================
# Stage: Dependencies
# ============================================
FROM base AS deps
WORKDIR /app

ARG EDITION=community
ENV NODE_ENV=development

# Copy workspace config
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./

# Copy all package.json files for workspace resolution
COPY apps/server/package.json ./apps/server/
COPY apps/server/apps/gateway/package.json ./apps/server/apps/gateway/
COPY apps/server/apps/im-worker/package.json ./apps/server/apps/im-worker/
COPY apps/server/libs/auth/package.json ./apps/server/libs/auth/
COPY apps/server/libs/database/package.json ./apps/server/libs/database/
COPY apps/server/libs/shared/package.json ./apps/server/libs/shared/
COPY apps/server/libs/redis/package.json ./apps/server/libs/redis/
COPY apps/server/libs/rabbitmq/package.json ./apps/server/libs/rabbitmq/
COPY apps/server/libs/ai-client/package.json ./apps/server/libs/ai-client/
COPY apps/server/libs/storage/package.json ./apps/server/libs/storage/
COPY apps/server/libs/agent-framework/package.json ./apps/server/libs/agent-framework/
COPY apps/server/libs/agent-runtime/package.json ./apps/server/libs/agent-runtime/

# Copy enterprise package.json files if they exist (for enterprise builds)
COPY enterprise/libs/tenant/package.json ./enterprise/libs/tenant/
COPY enterprise/libs/sso/package.json ./enterprise/libs/sso/
COPY enterprise/libs/audit/package.json ./enterprise/libs/audit/
COPY enterprise/libs/analytics/package.json ./enterprise/libs/analytics/
COPY enterprise/libs/license/package.json ./enterprise/libs/license/

RUN pnpm install --frozen-lockfile --ignore-scripts

# ============================================
# Stage: Builder
# ============================================
FROM deps AS builder
WORKDIR /app

ARG EDITION=community

# Copy source code
COPY apps/server ./apps/server

# Copy enterprise source code (for enterprise builds)
COPY enterprise ./enterprise

# Reinstall to create symlinks, ignore scripts to avoid husky
RUN pnpm install --frozen-lockfile --ignore-scripts

# Clean tsbuildinfo and build all packages
RUN find apps/server -name "*.tsbuildinfo" -delete && \
    find enterprise -name "*.tsbuildinfo" -delete 2>/dev/null || true && \
    pnpm --filter '@team9/*' --filter '!@team9/server' build

# Use pnpm deploy to create a standalone deployment
RUN pnpm --filter @team9/gateway deploy --prod /app/deploy

# ============================================
# Stage: Runner
# ============================================
FROM node:20-alpine AS runner
WORKDIR /app

ARG EDITION=community
ENV NODE_ENV=production
ENV EDITION=${EDITION}

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nestjs

# Copy deployed app (pnpm deploy now includes workspace packages with dist)
COPY --from=builder --chown=nestjs:nodejs /app/deploy ./

# Copy database migrations
COPY --from=builder --chown=nestjs:nodejs /app/apps/server/libs/database/migrations ./node_modules/@team9/database/migrations

USER nestjs

EXPOSE 3000

CMD ["node", "dist/main.js"]

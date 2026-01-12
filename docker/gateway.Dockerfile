# ============================================
# Team9 Gateway Service (预编译版本)
# ============================================

FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
RUN apk add --no-cache libc6-compat

# ============================================
# Stage: Dependencies
# ============================================
FROM base AS deps
WORKDIR /app

# Copy workspace config
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./

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

RUN pnpm install --frozen-lockfile

# ============================================
# Stage: Builder
# ============================================
FROM base AS builder
WORKDIR /app

# Copy dependencies
COPY --from=deps /app ./

# Copy source code
COPY apps/server ./apps/server

# Build all packages
WORKDIR /app/apps/server
RUN pnpm build

# ============================================
# Stage: Runner
# ============================================
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nestjs

# Copy node_modules
COPY --from=deps --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=deps --chown=nestjs:nodejs /app/apps/server/node_modules ./apps/server/node_modules

# Copy built artifacts
COPY --from=builder --chown=nestjs:nodejs /app/apps/server/apps/gateway/dist ./apps/server/apps/gateway/dist
COPY --from=builder --chown=nestjs:nodejs /app/apps/server/libs/shared/dist ./apps/server/libs/shared/dist
COPY --from=builder --chown=nestjs:nodejs /app/apps/server/libs/auth/dist ./apps/server/libs/auth/dist
COPY --from=builder --chown=nestjs:nodejs /app/apps/server/libs/database/dist ./apps/server/libs/database/dist
COPY --from=builder --chown=nestjs:nodejs /app/apps/server/libs/redis/dist ./apps/server/libs/redis/dist
COPY --from=builder --chown=nestjs:nodejs /app/apps/server/libs/rabbitmq/dist ./apps/server/libs/rabbitmq/dist
COPY --from=builder --chown=nestjs:nodejs /app/apps/server/libs/ai-client/dist ./apps/server/libs/ai-client/dist
COPY --from=builder --chown=nestjs:nodejs /app/apps/server/libs/storage/dist ./apps/server/libs/storage/dist

# Copy package.json files (needed for module resolution)
COPY --from=builder --chown=nestjs:nodejs /app/apps/server/libs/shared/package.json ./apps/server/libs/shared/
COPY --from=builder --chown=nestjs:nodejs /app/apps/server/libs/auth/package.json ./apps/server/libs/auth/
COPY --from=builder --chown=nestjs:nodejs /app/apps/server/libs/database/package.json ./apps/server/libs/database/
COPY --from=builder --chown=nestjs:nodejs /app/apps/server/libs/redis/package.json ./apps/server/libs/redis/
COPY --from=builder --chown=nestjs:nodejs /app/apps/server/libs/rabbitmq/package.json ./apps/server/libs/rabbitmq/
COPY --from=builder --chown=nestjs:nodejs /app/apps/server/libs/ai-client/package.json ./apps/server/libs/ai-client/
COPY --from=builder --chown=nestjs:nodejs /app/apps/server/libs/storage/package.json ./apps/server/libs/storage/

USER nestjs

WORKDIR /app/apps/server/apps/gateway

EXPOSE 3000

CMD ["node", "dist/main.js"]

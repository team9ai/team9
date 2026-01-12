# ============================================
# Team9 IM Worker Service (TypeScript Runtime)
# 使用 tsx 直接运行 TypeScript，无需预编译
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
# Stage: Runner (直接运行 TypeScript)
# ============================================
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nestjs

# Copy dependencies from deps stage
COPY --from=deps --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=deps --chown=nestjs:nodejs /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=deps --chown=nestjs:nodejs /app/apps/server/apps ./apps/server/apps
COPY --from=deps --chown=nestjs:nodejs /app/apps/server/libs ./apps/server/libs

# Copy source code and configs (overwrite with actual source)
COPY --chown=nestjs:nodejs apps/server/tsconfig.json ./apps/server/
COPY --chown=nestjs:nodejs apps/server/libs ./apps/server/libs
COPY --chown=nestjs:nodejs apps/server/apps/im-worker ./apps/server/apps/im-worker

# Copy workspace config files needed for module resolution
COPY --chown=nestjs:nodejs pnpm-workspace.yaml package.json ./

USER nestjs

WORKDIR /app/apps/server/apps/im-worker

EXPOSE 3001

CMD ["npx", "tsx", "src/main.ts"]

# ============================================
# Team9 Web Client (Static SPA)
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
COPY apps/client/package.json ./apps/client/

RUN pnpm install --frozen-lockfile

# ============================================
# Stage: Builder
# ============================================
FROM base AS builder
WORKDIR /app

COPY --from=deps /app ./
COPY apps/client ./apps/client

WORKDIR /app/apps/client

# Build arguments for environment variables
ARG VITE_API_URL
ARG VITE_WS_URL

ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_WS_URL=${VITE_WS_URL}

RUN pnpm build

# ============================================
# Stage: Runner (nginx for static files)
# ============================================
FROM nginx:alpine AS runner

# Copy built static files
COPY --from=builder /app/apps/client/dist /usr/share/nginx/html

# Custom nginx config for SPA routing
RUN echo 'server { \
    listen 80; \
    server_name _; \
    root /usr/share/nginx/html; \
    index index.html; \
    \
    location / { \
        try_files $uri $uri/ /index.html; \
    } \
    \
    location /assets { \
        expires 1y; \
        add_header Cache-Control "public, immutable"; \
    } \
    \
    gzip on; \
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml; \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

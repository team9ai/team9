# Team9 Monorepo

This monorepo contains both the client (Tauri) and server (NestJS) applications.

## Structure

```
team9/
├── apps/
│   ├── client/          # Tauri + React + Vite frontend
│   └── server/          # NestJS backend
│       ├── apps/
│       │   └── gateway/ # Main API gateway
│       └── libs/        # Shared libraries
├── package.json         # Root scripts
└── pnpm-workspace.yaml
```

## Prerequisites

- Node.js >= 18.0.0
- pnpm >= 8.0.0
- Rust (for Tauri client)

## Installation

```bash
# Install all dependencies
pnpm install:all
```

Or install separately:

```bash
# Install root dependencies
pnpm install

# Install client dependencies
cd apps/client && pnpm install

# Install server dependencies
cd apps/server && pnpm install
```

## Development

### Run both client and server

```bash
pnpm dev
```

### Run client only

```bash
# Web development
pnpm dev:client

# Desktop development (Tauri)
pnpm dev:desktop
```

### Run server only

```bash
pnpm dev:server
```

## Build

### Build everything

```bash
pnpm build
```

### Build client

```bash
pnpm build:client          # Web build
pnpm build:client:mac      # macOS app
pnpm build:client:windows  # Windows app
```

### Build server

```bash
pnpm build:server
```

## Database Commands

```bash
pnpm db:generate   # Generate Prisma/Drizzle client
pnpm db:migrate    # Run migrations
pnpm db:push       # Push schema changes
pnpm db:studio     # Open database studio
```

## Production

```bash
pnpm start:prod    # Start server in production mode
```

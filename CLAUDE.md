# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Team9 is a full-stack instant messaging and team collaboration platform built as a monorepo. The backend uses NestJS with PostgreSQL (Drizzle ORM), while the frontend is a Tauri-based cross-platform desktop app (React + TypeScript) with real-time WebSocket communication via Socket.io.

## Common Commands

### Development

```bash
pnpm dev              # Run server (gateway + im-worker) and client concurrently
pnpm dev:client       # Web frontend only (Vite dev server)
pnpm dev:desktop      # Tauri desktop app (hot reload)
pnpm dev:server       # Gateway service only
pnpm dev:im-worker    # Background IM worker service only
pnpm dev:server:all   # Both gateway and im-worker services
```

### Database Operations

```bash
pnpm db:generate      # Generate Drizzle schemas from TypeScript
pnpm db:migrate       # Run pending migrations
pnpm db:push          # Push schema changes to database (dev only)
pnpm db:studio        # Open Drizzle Studio UI for database inspection
```

### Building

```bash
pnpm build                 # Build both server and client
pnpm build:server          # Build NestJS backend
pnpm build:client          # Build web client
pnpm build:client:mac      # Build macOS Tauri app
pnpm build:client:windows  # Build Windows Tauri app
```

### Production

```bash
pnpm start:prod       # Start server in production mode
```

## Architecture

### Monorepo Structure

```
apps/
├── client/           # Tauri + React frontend
├── server/
│   ├── apps/
│   │   ├── gateway/  # Main API gateway (port 3000)
│   │   └── im-worker/  # Background IM worker service (port 3001)
│   └── libs/         # Shared libraries
│       ├── database/ # Drizzle schemas and DB module
│       ├── auth/     # Shared authentication
│       ├── ai-client/
│       ├── agent-framework/
│       ├── redis/
│       ├── rabbitmq/
│       └── shared/   # Common types, constants
└── debugger/         # Debug tool
```

### Backend Architecture (NestJS)

**Entry Point:** [apps/server/apps/gateway/src/main.ts](apps/server/apps/gateway/src/main.ts)

The backend follows a modular NestJS architecture with two main applications:

- **Gateway:** Main API service with REST endpoints and WebSocket gateway
- **IM Worker:** Background service for async processing (message persistence, routing, offline delivery)

**Key Modules:**

- **Auth Module** ([apps/server/apps/gateway/src/auth](apps/server/apps/gateway/src/auth)): JWT-based authentication with Passport strategy, 7-day token expiry
- **IM Module** ([apps/server/apps/gateway/src/im](apps/server/apps/gateway/src/im)): Instant messaging functionality
  - Channels: direct, public, private types
  - Messages: text, file, image, system types with threading support (parentId)
  - Users: profile management, status tracking
  - WebSocket: Socket.io gateway for real-time events
- **Workspace Module** ([apps/server/apps/gateway/src/workspace](apps/server/apps/gateway/src/workspace)): Multi-tenant workspace management
- **Edition Module** ([apps/server/apps/gateway/src/edition](apps/server/apps/gateway/src/edition)): Dynamic feature loading for Community vs Enterprise editions

**Edition System:**
The codebase supports Community and Enterprise editions via environment variable `EDITION=community|enterprise`. The Edition module conditionally loads features (e.g., TenantModule only in enterprise). Enterprise code lives in a separate git submodule at `enterprise/`.

**Database Layer:**

- Uses Drizzle ORM with PostgreSQL
- Schemas organized by domain in [apps/server/libs/database/schemas](apps/server/libs/database/schemas):
  - **im/**: users, channels, messages, channel_members, message_attachments, message_reactions, message_acks, mentions, user_channel_read_status
  - **tenant/**: tenants, tenant_members, workspace_invitations
- All migrations managed via `pnpm db:migrate`
- Schema changes pushed via `pnpm db:push` (dev) or `pnpm db:generate` + `pnpm db:migrate` (prod)

### Frontend Architecture (Tauri + React)

**Entry Point:** [apps/client/src/main.tsx](apps/client/src/main.tsx)

**State Management:**

- **Zustand** for UI state: theme, user profile, loading states
  - App store: [apps/client/src/stores/app.ts](apps/client/src/stores/app.ts)
  - Workspace store: [apps/client/src/stores/workspace.ts](apps/client/src/stores/workspace.ts)
  - Home store: [apps/client/src/stores/home.ts](apps/client/src/stores/home.ts)
- **TanStack React Query** for server state: messages, channels, users (caching, invalidation)
- Local component state for UI-only interactions

**Routing:**

- **TanStack Router** with file-based routing in [apps/client/src/routes](apps/client/src/routes)
- Protected routes via `_authenticated` layout
- Automatic route generation from directory structure

**HTTP Client:**

- Custom HttpClient class at [apps/client/src/services/http.ts](apps/client/src/services/http.ts)
- Request/response interceptors for auth tokens and error handling
- Centralized API client at [apps/client/src/services/api.ts](apps/client/src/services/api.ts)

**WebSocket Service:**

- Singleton pattern at [apps/client/src/services/websocket.ts](apps/client/src/services/websocket.ts)
- Auto-reconnection with exponential backoff
- Event queuing for offline operations
- Type-safe event emitters
- Channel join/leave lifecycle management

### Real-Time Communication

**WebSocket Events (Socket.io):**

Message Operations:

- `send_message` → `new_message`: Broadcasting new messages to channel members
- `mark_as_read` → `read_status_updated`: Read receipt tracking
- `add_reaction` → `reaction_added`, `reaction_removed`: Message reactions

User Presence:

- `user_online`, `user_offline`: Connection status
- `user_status_changed`: Status updates (online/offline/away/busy)
- `typing_start`, `typing_stop` → `user_typing`: Typing indicators

Channel Management:

- `join_channel`, `leave_channel`: Channel subscription lifecycle

**Message Features:**

- Threading via `parentId` field
- Mentions: @user, @channel, @everyone (parsed server-side)
- Attachments: file, image types
- Reactions: emoji-based reactions per message
- Read status: per-user, per-channel tracking via `user_channel_read_status` table

### Key Development Patterns

**Adding a New Database Table:**

1. Define schema in [apps/server/libs/database/schemas](apps/server/libs/database/schemas) using Drizzle syntax
2. Export from the appropriate index file (im/index.ts or tenant/index.ts)
3. Run `pnpm db:generate` to generate migration
4. Run `pnpm db:migrate` to apply migration
5. Update database module to inject the new table

**Adding a New API Endpoint:**

1. Create controller method in appropriate module (auth, im, workspace)
2. Implement business logic in service layer
3. Use Drizzle to query database via injected DatabaseService
4. Add DTO classes for request/response validation
5. Apply appropriate guards (JwtAuthGuard for protected routes)

**Adding a New WebSocket Event:**

1. Define event handler in [apps/server/apps/gateway/src/im/websocket/websocket.gateway.ts](apps/server/apps/gateway/src/im/websocket/websocket.gateway.ts)
2. Emit response events via `this.server.to(channelId).emit(event, data)`
3. Add client-side listener in [apps/client/src/services/websocket.ts](apps/client/src/services/websocket.ts)
4. Update React Query cache or Zustand store based on event data

**Adding a New Frontend Route:**

1. Create file in [apps/client/src/routes](apps/client/src/routes) following TanStack Router conventions
2. Use `_authenticated` layout for protected routes
3. Define loader functions for data fetching
4. Implement component with hooks for state/query management

## Technology Stack

**Frontend:**

- React 19, TypeScript 5.8+, Tauri 2
- TanStack Router 1.141, TanStack React Query 5.90
- Zustand 5.0, Socket.io-client
- Radix UI, Tailwind CSS 4.1, Lucide icons
- Vite 7

**Backend:**

- NestJS 11, TypeScript 5.8+
- PostgreSQL + Drizzle ORM
- Socket.io, JWT + Passport
- Redis, RabbitMQ
- Anthropic AI SDK, Google Generative AI

**Tooling:**

- pnpm workspaces, ESLint, Prettier
- Jest (testing), SWC (compilation)
- Husky + lint-staged (pre-commit hooks)

## Prerequisites

- Node.js >= 18.0.0
- pnpm >= 8.0.0
- Rust toolchain (for Tauri builds)
- PostgreSQL (local or remote)
- Redis (for caching/sessions)
- RabbitMQ (for message queuing)

# Bot Debugger — Design Spec

## Overview

A standalone web-based debugger tool that connects to the Team9 gateway as a bot/AI Staff identity, providing full bot simulation capabilities with real-time visibility into all WebSocket communication. Lives at `apps/debugger/` in the monorepo.

## Goals

- Enable developers to test the internal messaging system without depending on external bot services
- Simulate all bot behaviors: messaging, streaming, typing, reactions, channel operations
- Provide clear visibility into all sent and received WebSocket events with business-semantic rendering
- Support both manual token input and in-app bot creation

## Non-Goals

- General REST API debugging (use Postman/Hoppscotch) — the debugger only calls REST endpoints required for bot operations (sending messages, bot creation)
- Multi-bot simultaneous connections
- Message persistence to database (memory-only + export)
- Automated test script recording/playback

## Prerequisites / Setup

- **WebSocket namespace:** The gateway WebSocket runs on the `/im` namespace. The debugger must connect to `http://<host>:<port>/im`.
- **CORS:** The gateway's `CORS_ORIGIN` env var must include the debugger's dev origin (e.g., `http://localhost:5174`). Alternatively, the debugger's Vite config can proxy WebSocket connections through the dev server.
- **Bot token:** For initial use, a pre-existing `t9bot_` token is needed. The in-app bot creation feature requires uncommenting the bot controller REST endpoints (see Bot Creation section).
- **Gateway running:** The gateway service must be running (`pnpm dev:server`).

## Target Users

Developers and team members familiar with the internal protocol. UI optimized for information density over onboarding.

## Technical Stack

- **Framework:** Vite + React + TypeScript + Tailwind CSS (consistent with `apps/client/`)
- **WebSocket:** `socket.io-client` connecting to gateway `/im` namespace
- **HTTP:** `fetch` for REST API calls (sending messages, bot creation)
- **State:** Zustand for connection state, event store, filters
- **Virtual scroll:** `@tanstack/react-virtual` for event stream
- **JSON editing/viewing:** Monaco Editor or `@uiw/react-json-view`
- **Run command:** `pnpm dev:debugger` (Vite dev server)

## Architecture

### Layout

Classic three-column layout optimized for desktop:

| Column | Width       | Content                                        |
| ------ | ----------- | ---------------------------------------------- |
| Left   | 240px fixed | Connection config, channel list, bot info      |
| Center | flex        | Real-time event stream with semantic rendering |
| Right  | 320px fixed | Quick Actions / JSON Editor / Inspector tabs   |

Top bar: connection status, bot identity, Clear/Export/Disconnect actions.
Bottom bar: event counts (total/received/sent), latency, transport info.

### Core Modules

#### 1. DebugSocket — WebSocket Management

Wraps `socket.io-client` with full event interception:

- Connects to the `/im` namespace (e.g., `http://localhost:3000/im`)
- Supports `t9bot_` token authentication (passed via `handshake.auth.token`)
- Waits for `authenticated` event from server before marking connection as "ready"
- Handles `auth_error` event to surface connection failures
- Intercepts all incoming events via `socket.onAny()`
- Wraps all outgoing events via custom `emit()` that records before sending
- Measures latency via `ping`/`pong` events (gateway returns `serverTime`)
- No auto-reconnect — manual reconnect only (intentional for debugging)
- Each event recorded as:

```typescript
interface DebugEvent {
  id: string; // unique ID (nanoid)
  timestamp: number; // Date.now()
  direction: "in" | "out";
  eventName: string; // e.g. 'new_message', 'streaming_content'
  payload: unknown; // raw event payload
  channelId?: string; // extracted from payload if present
  meta?: {
    streamId?: string; // for streaming events
    userId?: string; // sender for incoming messages
    size: number; // JSON.stringify(payload).length
  };
}
```

#### 2. EventStore — Event Storage (Zustand)

```typescript
interface EventStore {
  events: DebugEvent[];
  filters: {
    direction: "all" | "in" | "out";
    eventTypes: string[]; // empty = all
    channelId: string | null;
    search: string;
  };

  // Computed
  filteredEvents: DebugEvent[];

  // Actions
  addEvent(event: DebugEvent): void;
  clearEvents(): void;
  exportEvents(): void; // download as JSON file
  setFilter(filter: Partial<Filters>): void;
}
```

#### 3. SemanticRenderer — Business-Level Event Rendering

Maps event names to preview components:

| Event                        | Rendering                                               |
| ---------------------------- | ------------------------------------------------------- |
| `new_message`                | Message bubble: avatar + username + content + timestamp |
| `message_updated`            | Updated message with diff indicator                     |
| `message_deleted`            | Strikethrough message preview                           |
| `streaming_start`            | Stream info: ID, target message, channel                |
| `streaming_content`          | Live text accumulation, merged by streamId              |
| `streaming_thinking_content` | Thinking text in distinct style                         |
| `streaming_end`              | Final stream summary with duration and chunk count      |
| `streaming_abort`            | Abort reason display                                    |
| `user_typing`                | "User is typing..." indicator                           |
| `reaction_added/removed`     | Emoji + user + message reference                        |
| `read_status_updated`        | Channel + last read message                             |
| `user_online/offline`        | User presence change                                    |
| `channel_joined/left`        | Channel membership change                               |
| `authenticated`              | Connection success with userId                          |
| `auth_error`                 | Authentication failure reason                           |
| `task:status_changed`        | Task ID + old/new status                                |
| Other                        | Generic: event name + truncated JSON summary            |

Every event has a collapsible "Raw JSON" section showing the full payload.

Streaming events with the same `streamId` are visually grouped and the content chunks are accumulated into a single live-updating preview.

#### 4. ActionPanel — Operation Panel

Three tabs:

**Tab 1: Quick Actions**

Pre-built forms for common bot operations:

- **Send Message:** channel selector + content textarea + thread toggle (parentId). Sends via REST API (`POST /v1/im/channels/:channelId/messages`) using the bot token as Bearer auth — messages are persisted and broadcast through the normal flow.
- **Streaming:** content textarea + Start/End/Abort controls + auto-chunk toggle (interval configurable) + thinking content toggle
- **Quick buttons grid:** Typing Start, Typing Stop, Mark Read, Add Reaction, Join Channel, Leave Channel

**Tab 2: JSON Editor**

- Event name input field
- Monaco/CodeMirror JSON editor for payload
- Send button
- Preset templates dropdown (common event payloads)

**Tab 3: Inspector**

- Click any event in the center stream → full JSON displayed here
- Timestamps, size, related events (e.g., streaming_start → content → end chain)
- Copy payload button

#### 5. BotManager — Bot Creation & Management

Two connection modes:

**Manual:** Paste existing `t9bot_` token + server URL → Connect

**Create New:**

> **Note:** The bot creation REST endpoints in `bot.controller.ts` are currently commented out. As a prerequisite, these endpoints need to be restored: `POST /v1/bots` (create bot), `POST /v1/bots/:id/regenerate-token` (generate token), `DELETE /v1/bots/:id/revoke-token` (revoke token).

1. User provides admin JWT (or logs in with email/password to get one)
2. Calls REST API to create a bot in a workspace
3. Receives `t9bot_` token
4. Auto-connects with the new token

**Persistence:**

- localStorage stores last 5 connection profiles: `{ alias, serverUrl, token, lastUsed }`
- Quick-switch between profiles
- Import/export config as JSON

### Streaming Simulation

Two modes for simulating bot streaming responses:

Both modes require selecting a target channel (bot must be a member — gateway validates membership in `handleStreamingStart`). The debugger generates a `streamId` (nanoid) and a placeholder `messageId` for `streaming_start`.

**Manual Mode:**

1. User writes full response text in textarea
2. Clicks "Start Stream"
3. Debugger sends `streaming_start` with `{ channelId, streamId, messageId }`
4. Auto-splits text into chunks (configurable size)
5. Sends `streaming_content` at configurable interval (default 500ms)
6. Sends `streaming_end` when complete
7. Optional: sends `streaming_thinking_content` before main content

**Interactive Mode:**

1. User clicks "Start" → sends `streaming_start` with `{ channelId, streamId, messageId }`
2. User types in textarea → each keystroke/pause sends `streaming_content` chunk
3. User clicks "End" → sends `streaming_end`
4. User clicks "Abort" → sends `streaming_abort` with reason

### Data Flow

```
WebSocket Events (streaming, typing, reactions, etc.):
  User Action (Quick Form / JSON Editor)
    → DebugSocket.emit(eventName, payload)
    → EventStore.add({ direction: 'out', ... })
    → socket.io sends to gateway

REST API Calls (sending messages, bot creation):
  User Action (Send Message form)
    → api.sendMessage(channelId, content)
    → EventStore.add({ direction: 'out', eventName: 'REST:POST /messages', ... })
    → fetch POST to gateway REST endpoint
    → Response logged to EventStore

Incoming Events:
  Gateway broadcasts event
    → socket.io receives
    → DebugSocket.onAny() interceptor
    → EventStore.add({ direction: 'in', ... })
    → SemanticRenderer picks component
    → Event Stream UI updates (virtual scroll)
```

## File Structure

```
apps/debugger/
├── index.html
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── package.json
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── stores/
│   │   ├── connection.ts      # Connection state, profiles
│   │   └── events.ts          # EventStore
│   ├── services/
│   │   ├── debug-socket.ts    # DebugSocket wrapper
│   │   └── api.ts             # REST API client (messages, bot creation)
│   ├── components/
│   │   ├── Layout.tsx          # Three-column layout shell
│   │   ├── TopBar.tsx
│   │   ├── BottomBar.tsx
│   │   ├── left/
│   │   │   ├── ConnectionPanel.tsx
│   │   │   ├── ChannelList.tsx
│   │   │   └── BotInfo.tsx
│   │   ├── center/
│   │   │   ├── EventStream.tsx       # Virtual scrolling list
│   │   │   ├── EventCard.tsx         # Single event container
│   │   │   ├── EventFilter.tsx       # Filter bar
│   │   │   └── renderers/
│   │   │       ├── MessageRenderer.tsx
│   │   │       ├── StreamingRenderer.tsx
│   │   │       ├── TypingRenderer.tsx
│   │   │       ├── PresenceRenderer.tsx
│   │   │       ├── ReactionRenderer.tsx
│   │   │       └── GenericRenderer.tsx
│   │   └── right/
│   │       ├── QuickActions.tsx
│   │       ├── JsonEditor.tsx
│   │       └── Inspector.tsx
│   ├── lib/
│   │   ├── event-types.ts     # Event name constants, type guards
│   │   └── utils.ts           # Formatting, ID generation
│   └── styles/
│       └── globals.css
```

## Integration with Monorepo

- `apps/debugger/` is auto-discovered by pnpm workspace (root `pnpm-workspace.yaml` already includes `apps/*`)
- Add `dev:debugger` script to root `package.json`: `"pnpm --filter debugger dev"`
- Import event types from `@team9/shared` (`apps/server/libs/shared`) to stay in sync with actual event schemas
- **Server-side prerequisite:** Uncomment bot creation/token endpoints in `bot.controller.ts` for full bot management support
- **CORS prerequisite:** Add debugger dev origin to `CORS_ORIGIN` env var, or configure Vite proxy

# Bot Debugger Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone web debugger that connects as a bot identity to test the Team9 IM system, with full visibility into WebSocket events and bot simulation capabilities.

**Architecture:** Three-column Vite+React app at `apps/debugger/`. Left panel for connection/channels, center for real-time event stream with semantic rendering, right for action forms and JSON editor. Connects to gateway's `/im` WebSocket namespace using `t9bot_` tokens, sends messages via REST API.

**Tech Stack:** Vite 7, React 19, TypeScript, Tailwind CSS 4, Zustand 5, socket.io-client, @tanstack/react-virtual, nanoid

**Spec:** `docs/superpowers/specs/2026-03-16-bot-debugger-design.md`

---

## Chunk 1: Project Scaffolding

### Task 1: Initialize Vite project

**Files:**

- Create: `apps/debugger/package.json`
- Create: `apps/debugger/index.html`
- Create: `apps/debugger/vite.config.ts`
- Create: `apps/debugger/tsconfig.json`
- Create: `apps/debugger/src/main.tsx`
- Create: `apps/debugger/src/App.tsx`
- Create: `apps/debugger/src/styles/globals.css`
- Modify: `package.json` (root — add `dev:debugger` script)

- [ ] **Step 1: Create `apps/debugger/package.json`**

```json
{
  "name": "@team9/debugger",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "socket.io-client": "^4.8.3",
    "zustand": "^5.0.0",
    "@tanstack/react-virtual": "^3.13.0",
    "nanoid": "^5.1.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.4.0",
    "typescript": "^5.8.0",
    "vite": "^7.0.0",
    "@tailwindcss/vite": "^4.1.0",
    "tailwindcss": "^4.1.0"
  }
}
```

- [ ] **Step 2: Create `apps/debugger/vite.config.ts`**

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5174,
  },
});
```

- [ ] **Step 3: Create `apps/debugger/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Create `apps/debugger/index.html`**

```html
<!doctype html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Team9 Bot Debugger</title>
  </head>
  <body class="bg-slate-950 text-slate-200">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Create `apps/debugger/src/styles/globals.css`**

```css
@import "tailwindcss";

@theme {
  --color-slate-925: oklch(0.14 0.01 260);
}
```

- [ ] **Step 6: Create `apps/debugger/src/main.tsx`**

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles/globals.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 7: Create `apps/debugger/src/App.tsx`** (placeholder)

```tsx
export function App() {
  return (
    <div className="flex h-screen flex-col bg-slate-950 text-slate-200">
      <div className="flex items-center justify-center flex-1 text-slate-500">
        Bot Debugger — loading...
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Add `dev:debugger` script to root `package.json`**

Add to the `"scripts"` section:

```json
"dev:debugger": "pnpm -C apps/debugger dev"
```

- [ ] **Step 9: Install dependencies and verify**

```bash
cd apps/debugger && pnpm install
cd ../.. && pnpm dev:debugger
```

Open `http://localhost:5174` — should show "Bot Debugger — loading..."

- [ ] **Step 10: Commit**

```bash
git add apps/debugger/ package.json pnpm-lock.yaml
git commit -m "feat(debugger): scaffold Vite + React project"
```

---

### Task 2: Define types and event constants

**Files:**

- Create: `apps/debugger/src/lib/events.ts`
- Create: `apps/debugger/src/lib/types.ts`

- [ ] **Step 1: Create `apps/debugger/src/lib/events.ts`**

Mirror the event names from `apps/server/libs/shared/src/events/event-names.ts`:

```typescript
/**
 * WebSocket event names — mirrored from @team9/shared.
 * Keep in sync with apps/server/libs/shared/src/events/event-names.ts
 */
export const WS_EVENTS = {
  AUTH: {
    AUTHENTICATED: "authenticated",
    AUTH_ERROR: "auth_error",
  },
  CHANNEL: {
    JOIN: "join_channel",
    LEAVE: "leave_channel",
    JOINED: "channel_joined",
    LEFT: "channel_left",
    CREATED: "channel_created",
    UPDATED: "channel_updated",
    DELETED: "channel_deleted",
  },
  MESSAGE: {
    NEW: "new_message",
    UPDATED: "message_updated",
    DELETED: "message_deleted",
  },
  READ_STATUS: {
    MARK_AS_READ: "mark_as_read",
    UPDATED: "read_status_updated",
  },
  TYPING: {
    START: "typing_start",
    STOP: "typing_stop",
    USER_TYPING: "user_typing",
  },
  USER: {
    ONLINE: "user_online",
    OFFLINE: "user_offline",
    STATUS_CHANGED: "user_status_changed",
  },
  REACTION: {
    ADD: "add_reaction",
    REMOVE: "remove_reaction",
    ADDED: "reaction_added",
    REMOVED: "reaction_removed",
  },
  WORKSPACE: {
    MEMBER_JOINED: "workspace_member_joined",
    MEMBER_LEFT: "workspace_member_left",
  },
  SYSTEM: {
    PING: "ping",
    PONG: "pong",
  },
  STREAMING: {
    START: "streaming_start",
    CONTENT: "streaming_content",
    THINKING_CONTENT: "streaming_thinking_content",
    END: "streaming_end",
    ABORT: "streaming_abort",
  },
  TASK: {
    STATUS_CHANGED: "task:status_changed",
    EXECUTION_CREATED: "task:execution_created",
  },
} as const;

/** Categorize events for filtering and coloring */
export type EventCategory =
  | "auth"
  | "channel"
  | "message"
  | "streaming"
  | "typing"
  | "presence"
  | "reaction"
  | "system"
  | "task"
  | "other";

export function getEventCategory(eventName: string): EventCategory {
  if (eventName.startsWith("streaming_")) return "streaming";
  if (
    eventName === "new_message" ||
    eventName === "message_updated" ||
    eventName === "message_deleted"
  )
    return "message";
  if (
    eventName === "typing_start" ||
    eventName === "typing_stop" ||
    eventName === "user_typing"
  )
    return "typing";
  if (
    eventName === "user_online" ||
    eventName === "user_offline" ||
    eventName === "user_status_changed"
  )
    return "presence";
  if (
    eventName.startsWith("reaction_") ||
    eventName.startsWith("add_reaction") ||
    eventName.startsWith("remove_reaction")
  )
    return "reaction";
  if (eventName === "authenticated" || eventName === "auth_error")
    return "auth";
  if (
    eventName.startsWith("channel_") ||
    eventName === "join_channel" ||
    eventName === "leave_channel"
  )
    return "channel";
  if (eventName === "ping" || eventName === "pong") return "system";
  if (eventName.startsWith("task:")) return "task";
  return "other";
}

/** Color mapping per category */
export const CATEGORY_COLORS: Record<EventCategory, string> = {
  auth: "#22c55e",
  channel: "#06b6d4",
  message: "#38bdf8",
  streaming: "#f59e0b",
  typing: "#8b5cf6",
  presence: "#a78bfa",
  reaction: "#ec4899",
  system: "#64748b",
  task: "#14b8a6",
  other: "#94a3b8",
};
```

- [ ] **Step 2: Create `apps/debugger/src/lib/types.ts`**

```typescript
export interface DebugEvent {
  id: string;
  timestamp: number;
  direction: "in" | "out";
  eventName: string;
  payload: unknown;
  channelId?: string;
  meta?: {
    streamId?: string;
    userId?: string;
    size: number;
  };
}

export interface ConnectionProfile {
  id: string;
  alias: string;
  serverUrl: string;
  token: string;
  lastUsed: number;
}

export interface StreamingSession {
  streamId: string;
  channelId: string;
  startedAt: number;
  chunks: string[];
  status: "active" | "ended" | "aborted";
}

/** Matches the server's StreamingStartEvent shape */
export interface StreamingStartPayload {
  streamId: string;
  channelId: string;
  parentId?: string;
}

export interface StreamingContentPayload {
  streamId: string;
  channelId: string;
  content: string;
}

export interface StreamingEndPayload {
  streamId: string;
  channelId: string;
}

export interface StreamingAbortPayload {
  streamId: string;
  channelId: string;
  reason: "error" | "cancelled" | "timeout" | "disconnect";
  error?: string;
}

export interface ChannelInfo {
  id: string;
  name: string;
  type: "direct" | "public" | "private";
  memberCount?: number;
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/debugger/src/lib/
git commit -m "feat(debugger): add event constants and type definitions"
```

---

## Chunk 2: Core Services

### Task 3: Implement EventStore (Zustand)

**Files:**

- Create: `apps/debugger/src/stores/events.ts`

- [ ] **Step 1: Create `apps/debugger/src/stores/events.ts`**

```typescript
import { create } from "zustand";
import type { DebugEvent } from "@/lib/types";
import { getEventCategory, type EventCategory } from "@/lib/events";

interface EventFilters {
  direction: "all" | "in" | "out";
  categories: EventCategory[];
  channelId: string | null;
  search: string;
}

interface EventStore {
  events: DebugEvent[];
  filters: EventFilters;
  selectedEventId: string | null;

  addEvent: (event: DebugEvent) => void;
  clearEvents: () => void;
  setFilter: (filter: Partial<EventFilters>) => void;
  setSelectedEvent: (id: string | null) => void;
  getFilteredEvents: () => DebugEvent[];
  exportEvents: () => void;
}

export const useEventStore = create<EventStore>((set, get) => ({
  events: [],
  filters: {
    direction: "all",
    categories: [],
    channelId: null,
    search: "",
  },
  selectedEventId: null,

  addEvent: (event) => set((state) => ({ events: [...state.events, event] })),

  clearEvents: () => set({ events: [], selectedEventId: null }),

  setFilter: (filter) =>
    set((state) => ({ filters: { ...state.filters, ...filter } })),

  setSelectedEvent: (id) => set({ selectedEventId: id }),

  getFilteredEvents: () => {
    const { events, filters } = get();
    return events.filter((e) => {
      if (filters.direction !== "all" && e.direction !== filters.direction)
        return false;
      if (
        filters.categories.length > 0 &&
        !filters.categories.includes(getEventCategory(e.eventName))
      )
        return false;
      if (filters.channelId && e.channelId !== filters.channelId) return false;
      if (filters.search) {
        const searchLower = filters.search.toLowerCase();
        const matchesName = e.eventName.toLowerCase().includes(searchLower);
        const matchesPayload = JSON.stringify(e.payload)
          .toLowerCase()
          .includes(searchLower);
        if (!matchesName && !matchesPayload) return false;
      }
      return true;
    });
  },

  exportEvents: () => {
    const { events } = get();
    const blob = new Blob([JSON.stringify(events, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `debugger-events-${new Date().toISOString().slice(0, 19)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  },
}));
```

- [ ] **Step 2: Commit**

```bash
git add apps/debugger/src/stores/events.ts
git commit -m "feat(debugger): add EventStore with filtering and export"
```

---

### Task 4: Implement ConnectionStore (Zustand)

**Files:**

- Create: `apps/debugger/src/stores/connection.ts`

- [ ] **Step 1: Create `apps/debugger/src/stores/connection.ts`**

```typescript
import { create } from "zustand";
import type { ChannelInfo, ConnectionProfile } from "@/lib/types";

type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "authenticating"
  | "connected"
  | "error";

interface ConnectionStore {
  status: ConnectionStatus;
  errorMessage: string | null;
  serverUrl: string;
  token: string;
  botUserId: string | null;
  botUsername: string | null;
  channels: ChannelInfo[];
  latencyMs: number | null;
  profiles: ConnectionProfile[];
  activeProfileId: string | null;

  setStatus: (status: ConnectionStatus, error?: string) => void;
  setServerUrl: (url: string) => void;
  setToken: (token: string) => void;
  setBotIdentity: (userId: string, username: string) => void;
  setChannels: (channels: ChannelInfo[]) => void;
  setLatency: (ms: number) => void;
  reset: () => void;

  // Profile management
  loadProfiles: () => void;
  saveProfile: (profile: Omit<ConnectionProfile, "id" | "lastUsed">) => void;
  deleteProfile: (id: string) => void;
  applyProfile: (id: string) => void;
}

const PROFILES_KEY = "debugger_profiles";
const MAX_PROFILES = 5;

export const useConnectionStore = create<ConnectionStore>((set, get) => ({
  status: "disconnected",
  errorMessage: null,
  serverUrl: "http://localhost:3000",
  token: "",
  botUserId: null,
  botUsername: null,
  channels: [],
  latencyMs: null,
  profiles: [],
  activeProfileId: null,

  setStatus: (status, error) => set({ status, errorMessage: error ?? null }),

  setServerUrl: (serverUrl) => set({ serverUrl }),
  setToken: (token) => set({ token }),

  setBotIdentity: (userId, username) =>
    set({ botUserId: userId, botUsername: username }),

  setChannels: (channels) => set({ channels }),
  setLatency: (ms) => set({ latencyMs: ms }),

  reset: () =>
    set({
      status: "disconnected",
      errorMessage: null,
      botUserId: null,
      botUsername: null,
      channels: [],
      latencyMs: null,
    }),

  loadProfiles: () => {
    try {
      const raw = localStorage.getItem(PROFILES_KEY);
      if (raw) set({ profiles: JSON.parse(raw) });
    } catch {
      // ignore corrupted localStorage
    }
  },

  saveProfile: (profile) => {
    const { profiles } = get();
    const id = crypto.randomUUID();
    const newProfile: ConnectionProfile = {
      ...profile,
      id,
      lastUsed: Date.now(),
    };
    const updated = [newProfile, ...profiles].slice(0, MAX_PROFILES);
    localStorage.setItem(PROFILES_KEY, JSON.stringify(updated));
    set({ profiles: updated, activeProfileId: id });
  },

  deleteProfile: (id) => {
    const { profiles } = get();
    const updated = profiles.filter((p) => p.id !== id);
    localStorage.setItem(PROFILES_KEY, JSON.stringify(updated));
    set({ profiles: updated });
  },

  applyProfile: (id) => {
    const { profiles } = get();
    const profile = profiles.find((p) => p.id === id);
    if (profile) {
      set({
        serverUrl: profile.serverUrl,
        token: profile.token,
        activeProfileId: id,
      });
      // Update lastUsed
      const updated = profiles.map((p) =>
        p.id === id ? { ...p, lastUsed: Date.now() } : p,
      );
      localStorage.setItem(PROFILES_KEY, JSON.stringify(updated));
      set({ profiles: updated });
    }
  },
}));
```

- [ ] **Step 2: Commit**

```bash
git add apps/debugger/src/stores/connection.ts
git commit -m "feat(debugger): add ConnectionStore with profile management"
```

---

### Task 5: Implement DebugSocket service

**Files:**

- Create: `apps/debugger/src/services/debug-socket.ts`
- Create: `apps/debugger/src/lib/utils.ts`

- [ ] **Step 1: Create `apps/debugger/src/lib/utils.ts`**

```typescript
import { nanoid } from "nanoid";

export function generateId(): string {
  return nanoid(12);
}

export function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function extractChannelId(payload: unknown): string | undefined {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "channelId" in payload
  ) {
    return (payload as Record<string, unknown>).channelId as string;
  }
  return undefined;
}

export function extractStreamId(payload: unknown): string | undefined {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "streamId" in payload
  ) {
    return (payload as Record<string, unknown>).streamId as string;
  }
  return undefined;
}

export function extractUserId(payload: unknown): string | undefined {
  if (typeof payload === "object" && payload !== null) {
    const p = payload as Record<string, unknown>;
    return (p.senderId ?? p.userId) as string | undefined;
  }
  return undefined;
}
```

- [ ] **Step 2: Create `apps/debugger/src/services/debug-socket.ts`**

```typescript
import { io, type Socket } from "socket.io-client";
import { useEventStore } from "@/stores/events";
import { useConnectionStore } from "@/stores/connection";
import { WS_EVENTS } from "@/lib/events";
import type { DebugEvent } from "@/lib/types";
import {
  generateId,
  extractChannelId,
  extractStreamId,
  extractUserId,
} from "@/lib/utils";

let socket: Socket | null = null;

function recordEvent(
  direction: "in" | "out",
  eventName: string,
  payload: unknown,
): DebugEvent {
  const event: DebugEvent = {
    id: generateId(),
    timestamp: Date.now(),
    direction,
    eventName,
    payload,
    channelId: extractChannelId(payload),
    meta: {
      streamId: extractStreamId(payload),
      userId: extractUserId(payload),
      size: JSON.stringify(payload ?? "").length,
    },
  };
  useEventStore.getState().addEvent(event);
  return event;
}

export function connect(serverUrl: string, token: string): void {
  if (socket?.connected) {
    socket.disconnect();
  }

  const connStore = useConnectionStore.getState();
  connStore.setStatus("connecting");

  // Connect to /im namespace
  const url = serverUrl.replace(/\/$/, "") + "/im";
  socket = io(url, {
    auth: { token },
    transports: ["websocket"],
    reconnection: false, // manual reconnect only for debugging
  });

  socket.on("connect", () => {
    connStore.setStatus("authenticating");
    recordEvent("in", "connect", { socketId: socket?.id });
  });

  socket.on(WS_EVENTS.AUTH.AUTHENTICATED, (data: unknown) => {
    recordEvent("in", WS_EVENTS.AUTH.AUTHENTICATED, data);
    const payload = data as { userId?: string; username?: string };
    if (payload.userId) {
      connStore.setBotIdentity(payload.userId, payload.username ?? "unknown");
    }
    connStore.setStatus("connected");
  });

  socket.on(WS_EVENTS.AUTH.AUTH_ERROR, (data: unknown) => {
    recordEvent("in", WS_EVENTS.AUTH.AUTH_ERROR, data);
    const msg =
      typeof data === "object" && data !== null && "message" in data
        ? String((data as Record<string, unknown>).message)
        : "Authentication failed";
    connStore.setStatus("error", msg);
  });

  socket.on("connect_error", (err: Error) => {
    recordEvent("in", "connect_error", { message: err.message });
    connStore.setStatus("error", err.message);
  });

  socket.on("disconnect", (reason: string) => {
    recordEvent("in", "disconnect", { reason });
    connStore.setStatus("disconnected");
  });

  // Intercept ALL incoming events
  socket.onAny((eventName: string, ...args: unknown[]) => {
    // Skip events already handled above
    if (
      eventName === WS_EVENTS.AUTH.AUTHENTICATED ||
      eventName === WS_EVENTS.AUTH.AUTH_ERROR
    ) {
      return;
    }
    recordEvent("in", eventName, args.length === 1 ? args[0] : args);
  });

  // Latency measurement via ping with ack callback
  // The gateway's handlePing returns pong as a socket.io acknowledgement, not a separate event.
  setInterval(() => {
    if (socket?.connected) {
      const start = Date.now();
      socket.emit(WS_EVENTS.SYSTEM.PING, { timestamp: start }, () => {
        connStore.setLatency(Date.now() - start);
      });
    }
  }, 30000);
}

export function disconnect(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
    useConnectionStore.getState().reset();
  }
}

export function emit(
  eventName: string,
  payload: unknown,
  ack?: (...args: unknown[]) => void,
): void {
  if (!socket?.connected) {
    console.warn("Socket not connected");
    return;
  }
  recordEvent("out", eventName, payload);
  if (ack) {
    socket.emit(eventName, payload, ack);
  } else {
    socket.emit(eventName, payload);
  }
}

export function getSocket(): Socket | null {
  return socket;
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/debugger/src/lib/utils.ts apps/debugger/src/services/debug-socket.ts
git commit -m "feat(debugger): add DebugSocket service with event interception"
```

---

### Task 6: Implement REST API client

**Files:**

- Create: `apps/debugger/src/services/api.ts`

- [ ] **Step 1: Create `apps/debugger/src/services/api.ts`**

```typescript
import { useConnectionStore } from "@/stores/connection";
import { useEventStore } from "@/stores/events";
import { generateId } from "@/lib/utils";
import type { DebugEvent } from "@/lib/types";

function getBaseUrl(): string {
  return useConnectionStore.getState().serverUrl.replace(/\/$/, "") + "/api";
}

function getAuthHeaders(): HeadersInit {
  const token = useConnectionStore.getState().token;
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

function recordRestEvent(
  method: string,
  path: string,
  body: unknown,
  response: unknown,
  status: number,
): void {
  const event: DebugEvent = {
    id: generateId(),
    timestamp: Date.now(),
    direction: "out",
    eventName: `REST:${method} ${path}`,
    payload: { request: body, response, status },
    meta: {
      size: JSON.stringify(body ?? "").length,
    },
  };
  useEventStore.getState().addEvent(event);
}

export async function sendMessage(
  channelId: string,
  content: string,
  parentId?: string,
): Promise<unknown> {
  const path = `/v1/im/channels/${channelId}/messages`;
  const body = { content, parentId };

  const res = await fetch(`${getBaseUrl()}${path}`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(body),
  });

  const data = await res.json();
  recordRestEvent("POST", path, body, data, res.status);
  return data;
}

export async function getChannels(): Promise<unknown> {
  const path = "/v1/im/channels";
  const res = await fetch(`${getBaseUrl()}${path}`, {
    headers: getAuthHeaders(),
  });
  const data = await res.json();
  return data;
}

export async function getUser(userId: string): Promise<unknown> {
  const path = `/v1/im/users/${userId}`;
  const res = await fetch(`${getBaseUrl()}${path}`, {
    headers: getAuthHeaders(),
  });
  const data = await res.json();
  return data;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/debugger/src/services/api.ts
git commit -m "feat(debugger): add REST API client for messages and bot info"
```

---

## Chunk 3: Layout Shell & Left Panel

### Task 7: Create three-column layout shell

**Files:**

- Create: `apps/debugger/src/components/Layout.tsx`
- Create: `apps/debugger/src/components/TopBar.tsx`
- Create: `apps/debugger/src/components/BottomBar.tsx`
- Modify: `apps/debugger/src/App.tsx`

- [ ] **Step 1: Create `apps/debugger/src/components/TopBar.tsx`**

```tsx
import { useConnectionStore } from "@/stores/connection";
import { useEventStore } from "@/stores/events";
import { disconnect } from "@/services/debug-socket";

const STATUS_STYLES: Record<string, string> = {
  connected: "bg-emerald-900/50 text-emerald-400",
  connecting: "bg-yellow-900/50 text-yellow-400",
  authenticating: "bg-yellow-900/50 text-yellow-400",
  disconnected: "bg-slate-700/50 text-slate-400",
  error: "bg-red-900/50 text-red-400",
};

const STATUS_DOT: Record<string, string> = {
  connected: "text-emerald-400",
  connecting: "text-yellow-400 animate-pulse",
  authenticating: "text-yellow-400 animate-pulse",
  disconnected: "text-slate-500",
  error: "text-red-400",
};

export function TopBar() {
  const { status, botUsername, serverUrl, errorMessage } = useConnectionStore();
  const { clearEvents, exportEvents } = useEventStore();

  return (
    <div className="flex items-center justify-between px-4 py-2 bg-slate-900 border-b border-slate-700">
      <div className="flex items-center gap-3">
        <span className="font-bold text-sky-400 text-sm">Bot Debugger</span>
        <span
          className={`px-2 py-0.5 rounded text-xs font-mono ${STATUS_STYLES[status]}`}
        >
          <span className={STATUS_DOT[status]}>●</span> {status}
        </span>
        {botUsername && (
          <span className="text-xs text-slate-400 font-mono">
            bot: {botUsername} | {serverUrl}
          </span>
        )}
        {errorMessage && (
          <span className="text-xs text-red-400">{errorMessage}</span>
        )}
      </div>
      <div className="flex gap-2">
        <button
          onClick={clearEvents}
          className="px-2 py-1 text-xs border border-slate-600 rounded hover:bg-slate-800"
        >
          Clear
        </button>
        <button
          onClick={exportEvents}
          className="px-2 py-1 text-xs border border-slate-600 rounded hover:bg-slate-800"
        >
          Export
        </button>
        {status === "connected" && (
          <button
            onClick={disconnect}
            className="px-2 py-1 text-xs bg-red-700 rounded hover:bg-red-600"
          >
            Disconnect
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `apps/debugger/src/components/BottomBar.tsx`**

```tsx
import { useConnectionStore } from "@/stores/connection";
import { useEventStore } from "@/stores/events";

export function BottomBar() {
  const { latencyMs } = useConnectionStore();
  const events = useEventStore((s) => s.events);

  const total = events.length;
  const received = events.filter((e) => e.direction === "in").length;
  const sent = events.filter((e) => e.direction === "out").length;

  return (
    <div className="flex items-center justify-between px-4 py-1 bg-slate-900 border-t border-slate-700 text-xs text-slate-500 font-mono">
      <div className="flex gap-4">
        <span>
          Events: <span className="text-slate-200">{total}</span>
        </span>
        <span>
          Received: <span className="text-sky-400">{received}</span>
        </span>
        <span>
          Sent: <span className="text-amber-400">{sent}</span>
        </span>
        {latencyMs !== null && (
          <span>
            Latency:{" "}
            <span
              className={
                latencyMs < 100 ? "text-emerald-400" : "text-amber-400"
              }
            >
              {latencyMs}ms
            </span>
          </span>
        )}
      </div>
      <span>Socket.io | Transport: websocket</span>
    </div>
  );
}
```

- [ ] **Step 3: Create `apps/debugger/src/components/Layout.tsx`**

```tsx
import { TopBar } from "./TopBar";
import { BottomBar } from "./BottomBar";
import type { ReactNode } from "react";

interface LayoutProps {
  left: ReactNode;
  center: ReactNode;
  right: ReactNode;
}

export function Layout({ left, center, right }: LayoutProps) {
  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-200">
      <TopBar />
      <div className="flex flex-1 min-h-0">
        <div className="w-60 border-r border-slate-700 flex flex-col overflow-y-auto">
          {left}
        </div>
        <div className="flex-1 flex flex-col min-w-0">{center}</div>
        <div className="w-80 border-l border-slate-700 flex flex-col overflow-y-auto">
          {right}
        </div>
      </div>
      <BottomBar />
    </div>
  );
}
```

- [ ] **Step 4: Update `apps/debugger/src/App.tsx`**

```tsx
import { useEffect } from "react";
import { Layout } from "@/components/Layout";
import { useConnectionStore } from "@/stores/connection";

function LeftPlaceholder() {
  return <div className="p-3 text-xs text-slate-500">Left panel</div>;
}
function CenterPlaceholder() {
  return (
    <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
      Connect to a server to see events
    </div>
  );
}
function RightPlaceholder() {
  return <div className="p-3 text-xs text-slate-500">Right panel</div>;
}

export function App() {
  const loadProfiles = useConnectionStore((s) => s.loadProfiles);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  return (
    <Layout
      left={<LeftPlaceholder />}
      center={<CenterPlaceholder />}
      right={<RightPlaceholder />}
    />
  );
}
```

- [ ] **Step 5: Verify** — run `pnpm dev:debugger`, should see three-column layout with top/bottom bars.

- [ ] **Step 6: Commit**

```bash
git add apps/debugger/src/components/ apps/debugger/src/App.tsx
git commit -m "feat(debugger): add three-column layout with TopBar and BottomBar"
```

---

### Task 8: Build ConnectionPanel (left panel)

**Files:**

- Create: `apps/debugger/src/components/left/ConnectionPanel.tsx`

- [ ] **Step 1: Create `apps/debugger/src/components/left/ConnectionPanel.tsx`**

```tsx
import { useState } from "react";
import { useConnectionStore } from "@/stores/connection";
import { connect } from "@/services/debug-socket";

export function ConnectionPanel() {
  const {
    status,
    serverUrl,
    token,
    setServerUrl,
    setToken,
    profiles,
    saveProfile,
    deleteProfile,
    applyProfile,
  } = useConnectionStore();

  const [showProfiles, setShowProfiles] = useState(false);

  const isConnected = status === "connected";
  const canConnect = !isConnected && token.length > 0 && serverUrl.length > 0;

  const handleConnect = () => {
    if (canConnect) {
      connect(serverUrl, token);
    }
  };

  const handleSaveProfile = () => {
    const alias = prompt("Profile name:");
    if (alias) {
      saveProfile({ alias, serverUrl, token });
    }
  };

  return (
    <div className="flex flex-col">
      <div className="px-3 py-2 bg-slate-900 border-b border-slate-700 text-[10px] uppercase tracking-widest text-slate-500">
        Connection
      </div>
      <div className="p-3 space-y-2 border-b border-slate-700">
        <div>
          <label className="text-[10px] text-slate-500 block mb-1">
            Server URL
          </label>
          <input
            className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs font-mono text-slate-200 focus:border-sky-500 focus:outline-none"
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            placeholder="http://localhost:3000"
            disabled={isConnected}
          />
        </div>
        <div>
          <label className="text-[10px] text-slate-500 block mb-1">
            Bot Token
          </label>
          <input
            className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs font-mono text-slate-200 focus:border-sky-500 focus:outline-none"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="t9bot_..."
            disabled={isConnected}
          />
        </div>
        <div className="flex gap-1">
          <button
            onClick={handleConnect}
            disabled={!canConnect}
            className="flex-1 text-center text-xs py-1.5 rounded bg-sky-700 hover:bg-sky-600 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Connect
          </button>
          <button
            onClick={handleSaveProfile}
            className="text-xs px-2 py-1.5 rounded border border-slate-600 hover:bg-slate-800"
          >
            Save
          </button>
        </div>
      </div>

      {/* Saved Profiles */}
      {profiles.length > 0 && (
        <>
          <button
            onClick={() => setShowProfiles(!showProfiles)}
            className="px-3 py-2 bg-slate-900 border-b border-slate-700 text-[10px] uppercase tracking-widest text-slate-500 text-left hover:bg-slate-800 flex justify-between"
          >
            <span>Profiles ({profiles.length})</span>
            <span>{showProfiles ? "▼" : "▶"}</span>
          </button>
          {showProfiles &&
            profiles.map((p) => (
              <div
                key={p.id}
                className="px-3 py-2 border-b border-slate-800 flex items-center justify-between hover:bg-slate-900/50 cursor-pointer group"
                onClick={() => applyProfile(p.id)}
              >
                <div>
                  <div className="text-xs text-slate-200">{p.alias}</div>
                  <div className="text-[10px] text-slate-500 font-mono truncate max-w-[140px]">
                    {p.serverUrl}
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteProfile(p.id);
                  }}
                  className="text-[10px] text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100"
                >
                  ✕
                </button>
              </div>
            ))}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/debugger/src/components/left/ConnectionPanel.tsx
git commit -m "feat(debugger): add ConnectionPanel with profile management"
```

---

### Task 9: Build ChannelList and BotInfo (left panel)

**Files:**

- Create: `apps/debugger/src/components/left/ChannelList.tsx`
- Create: `apps/debugger/src/components/left/BotInfo.tsx`

- [ ] **Step 1: Create `apps/debugger/src/components/left/ChannelList.tsx`**

```tsx
import { useConnectionStore } from "@/stores/connection";
import { useEventStore } from "@/stores/events";

export function ChannelList() {
  const channels = useConnectionStore((s) => s.channels);
  const { filters, setFilter } = useEventStore();

  const selectedChannelId = filters.channelId;

  if (channels.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-slate-600">
        No channels — connect first
      </div>
    );
  }

  return (
    <>
      <div className="px-3 py-2 bg-slate-900 border-b border-slate-700 text-[10px] uppercase tracking-widest text-slate-500">
        Channels ({channels.length})
      </div>
      {channels.map((ch) => (
        <div
          key={ch.id}
          className={`px-3 py-2 cursor-pointer border-b border-slate-800/50 ${
            selectedChannelId === ch.id
              ? "bg-sky-950/50 border-l-2 border-l-sky-400"
              : "hover:bg-slate-900/50 border-l-2 border-l-transparent"
          }`}
          onClick={() =>
            setFilter({
              channelId: selectedChannelId === ch.id ? null : ch.id,
            })
          }
        >
          <div className="text-xs text-slate-200">
            {ch.type === "direct" ? "DM" : "#"} {ch.name}
          </div>
          {ch.memberCount !== undefined && (
            <div className="text-[10px] text-slate-600">
              {ch.memberCount} members
            </div>
          )}
        </div>
      ))}
    </>
  );
}
```

- [ ] **Step 2: Create `apps/debugger/src/components/left/BotInfo.tsx`**

```tsx
import { useConnectionStore } from "@/stores/connection";

export function BotInfo() {
  const { botUserId, botUsername, status } = useConnectionStore();

  if (status !== "connected" || !botUserId) return null;

  return (
    <>
      <div className="px-3 py-2 bg-slate-900 border-b border-slate-700 border-t border-t-slate-700 text-[10px] uppercase tracking-widest text-slate-500">
        Bot Info
      </div>
      <div className="px-3 py-2 text-xs font-mono space-y-1">
        <div>
          <span className="text-slate-500">ID: </span>
          <span className="text-amber-400">{botUserId.slice(0, 8)}...</span>
        </div>
        <div>
          <span className="text-slate-500">User: </span>
          <span className="text-slate-200">{botUsername}</span>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 3: Wire left panel into App.tsx**

Update `App.tsx` to replace `LeftPlaceholder`:

```tsx
import { ConnectionPanel } from "@/components/left/ConnectionPanel";
import { ChannelList } from "@/components/left/ChannelList";
import { BotInfo } from "@/components/left/BotInfo";

function LeftPanel() {
  return (
    <>
      <ConnectionPanel />
      <ChannelList />
      <div className="flex-1" />
      <BotInfo />
    </>
  );
}
```

Replace `left={<LeftPlaceholder />}` with `left={<LeftPanel />}`.

- [ ] **Step 4: Commit**

```bash
git add apps/debugger/src/components/left/ apps/debugger/src/App.tsx
git commit -m "feat(debugger): add ChannelList, BotInfo, and wire left panel"
```

---

## Chunk 4: Event Stream (Center Panel)

### Task 10: Build EventFilter bar

**Files:**

- Create: `apps/debugger/src/components/center/EventFilter.tsx`

- [ ] **Step 1: Create `apps/debugger/src/components/center/EventFilter.tsx`**

```tsx
import { useEventStore } from "@/stores/events";
import { CATEGORY_COLORS, type EventCategory } from "@/lib/events";

const DIRECTION_OPTIONS = [
  { value: "all", label: "All" },
  { value: "in", label: "↓ Received" },
  { value: "out", label: "↑ Sent" },
] as const;

const CATEGORY_OPTIONS: { value: EventCategory; label: string }[] = [
  { value: "message", label: "Messages" },
  { value: "streaming", label: "Streaming" },
  { value: "typing", label: "Typing" },
  { value: "presence", label: "Presence" },
  { value: "channel", label: "Channel" },
  { value: "reaction", label: "Reaction" },
  { value: "auth", label: "Auth" },
  { value: "task", label: "Task" },
  { value: "system", label: "System" },
];

export function EventFilter() {
  const { filters, setFilter } = useEventStore();

  const toggleCategory = (cat: EventCategory) => {
    const current = filters.categories;
    const next = current.includes(cat)
      ? current.filter((c) => c !== cat)
      : [...current, cat];
    setFilter({ categories: next });
  };

  return (
    <div className="flex items-center px-3 py-2 bg-slate-900 border-b border-slate-700 gap-2 flex-wrap">
      <span className="text-[10px] text-slate-500 uppercase tracking-widest">
        Events
      </span>
      <span className="text-slate-700">|</span>

      {/* Direction filter */}
      {DIRECTION_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => setFilter({ direction: opt.value })}
          className={`text-[10px] px-1.5 py-0.5 rounded ${
            filters.direction === opt.value
              ? "bg-sky-900/50 text-sky-400"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          {opt.label}
        </button>
      ))}

      <span className="text-slate-700">|</span>

      {/* Category filter chips */}
      {CATEGORY_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => toggleCategory(opt.value)}
          className={`text-[10px] px-1.5 py-0.5 rounded border ${
            filters.categories.includes(opt.value)
              ? "border-current opacity-100"
              : "border-transparent opacity-50 hover:opacity-75"
          }`}
          style={{ color: CATEGORY_COLORS[opt.value] }}
        >
          {opt.label}
        </button>
      ))}

      <div className="flex-1" />

      {/* Search */}
      <input
        className="bg-slate-950 border border-slate-700 rounded px-2 py-0.5 text-xs font-mono text-slate-200 w-40 focus:border-sky-500 focus:outline-none"
        placeholder="Filter events..."
        value={filters.search}
        onChange={(e) => setFilter({ search: e.target.value })}
      />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/debugger/src/components/center/EventFilter.tsx
git commit -m "feat(debugger): add EventFilter bar with direction, category, and search"
```

---

### Task 11: Build semantic event renderers

**Files:**

- Create: `apps/debugger/src/components/center/renderers/MessageRenderer.tsx`
- Create: `apps/debugger/src/components/center/renderers/StreamingRenderer.tsx`
- Create: `apps/debugger/src/components/center/renderers/PresenceRenderer.tsx`
- Create: `apps/debugger/src/components/center/renderers/GenericRenderer.tsx`
- Create: `apps/debugger/src/components/center/renderers/index.tsx`

- [ ] **Step 1: Create `MessageRenderer.tsx`**

```tsx
import type { DebugEvent } from "@/lib/types";

export function MessageRenderer({ event }: { event: DebugEvent }) {
  const p = event.payload as Record<string, unknown> | undefined;
  if (!p) return null;

  const sender =
    (p.sender as Record<string, unknown>)?.displayName ??
    (p.sender as Record<string, unknown>)?.username ??
    p.senderId ??
    "unknown";
  const content = (p.content as string) ?? "";
  const parentId = p.parentId as string | undefined;

  return (
    <div className="bg-slate-950 rounded p-2 mt-1">
      <div className="flex items-center gap-1.5 mb-1">
        <div className="w-5 h-5 bg-indigo-600 rounded-full flex items-center justify-center text-[9px] text-white font-bold">
          {String(sender).charAt(0).toUpperCase()}
        </div>
        <span className="text-xs font-medium text-slate-200">
          {String(sender)}
        </span>
        {parentId && (
          <span className="text-[10px] text-slate-500">
            (thread: {String(parentId).slice(0, 8)}...)
          </span>
        )}
      </div>
      <div className="text-xs text-slate-300 pl-6 break-words">{content}</div>
    </div>
  );
}
```

- [ ] **Step 2: Create `StreamingRenderer.tsx`**

```tsx
import type { DebugEvent } from "@/lib/types";
import { useEventStore } from "@/stores/events";

export function StreamingRenderer({ event }: { event: DebugEvent }) {
  const p = event.payload as Record<string, unknown> | undefined;
  if (!p) return null;

  const streamId = p.streamId as string | undefined;
  const content = p.content as string | undefined;
  const reason = p.reason as string | undefined;

  if (event.eventName === "streaming_start") {
    return (
      <div className="text-xs text-slate-400 mt-1">
        Stream{" "}
        <span className="text-amber-400 font-mono">
          {streamId?.slice(0, 8)}...
        </span>{" "}
        started
      </div>
    );
  }

  if (
    event.eventName === "streaming_content" ||
    event.eventName === "streaming_thinking_content"
  ) {
    const isThinking = event.eventName === "streaming_thinking_content";
    return (
      <div
        className={`bg-slate-950 rounded p-2 mt-1 ${isThinking ? "border-l-2 border-purple-500" : ""}`}
      >
        <div className="text-xs text-slate-300 break-words whitespace-pre-wrap">
          {isThinking && (
            <span className="text-purple-400 text-[10px]">[thinking] </span>
          )}
          {content}
        </div>
      </div>
    );
  }

  if (event.eventName === "streaming_end") {
    return (
      <div className="text-xs text-emerald-400 mt-1">
        Stream <span className="font-mono">{streamId?.slice(0, 8)}...</span>{" "}
        ended
      </div>
    );
  }

  if (event.eventName === "streaming_abort") {
    return (
      <div className="text-xs text-red-400 mt-1">
        Stream <span className="font-mono">{streamId?.slice(0, 8)}...</span>{" "}
        aborted: {reason}
      </div>
    );
  }

  return null;
}

/** Aggregated streaming view — shows accumulated content for a streamId */
export function StreamingAggregateRenderer({ streamId }: { streamId: string }) {
  const events = useEventStore((s) => s.events);
  const streamEvents = events.filter(
    (e) => e.meta?.streamId === streamId && e.eventName === "streaming_content",
  );

  if (streamEvents.length === 0) return null;

  // The last streaming_content has the full accumulated text
  const lastContent = streamEvents[streamEvents.length - 1];
  const content = (lastContent.payload as Record<string, unknown>)
    ?.content as string;

  return (
    <div className="bg-slate-950 rounded p-2 mt-1 border border-amber-500/20">
      <div className="text-[10px] text-amber-400 mb-1">
        Streaming ({streamEvents.length} chunks)
      </div>
      <div className="text-xs text-slate-300 break-words whitespace-pre-wrap">
        {content}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `PresenceRenderer.tsx`**

```tsx
import type { DebugEvent } from "@/lib/types";

export function PresenceRenderer({ event }: { event: DebugEvent }) {
  const p = event.payload as Record<string, unknown> | undefined;
  const username = (p?.username ?? p?.userId ?? "unknown") as string;

  if (event.eventName === "user_online") {
    return (
      <span className="text-xs text-emerald-400">{username} came online</span>
    );
  }
  if (event.eventName === "user_offline") {
    return (
      <span className="text-xs text-slate-400">{username} went offline</span>
    );
  }
  if (event.eventName === "user_typing") {
    return (
      <span className="text-xs text-purple-400">{username} is typing...</span>
    );
  }
  return null;
}
```

- [ ] **Step 4: Create `GenericRenderer.tsx`**

```tsx
import type { DebugEvent } from "@/lib/types";

export function GenericRenderer({ event }: { event: DebugEvent }) {
  const summary =
    typeof event.payload === "object" && event.payload !== null
      ? JSON.stringify(event.payload).slice(0, 120)
      : String(event.payload ?? "");

  return (
    <div className="text-xs text-slate-400 mt-1 font-mono truncate">
      {summary}
      {summary.length >= 120 && "..."}
    </div>
  );
}
```

- [ ] **Step 5: Create `renderers/index.tsx`** — renderer selector

```tsx
import type { DebugEvent } from "@/lib/types";
import { getEventCategory } from "@/lib/events";
import { MessageRenderer } from "./MessageRenderer";
import { StreamingRenderer } from "./StreamingRenderer";
import { PresenceRenderer } from "./PresenceRenderer";
import { GenericRenderer } from "./GenericRenderer";

export function renderEventPreview(event: DebugEvent) {
  const category = getEventCategory(event.eventName);

  switch (category) {
    case "message":
      return <MessageRenderer event={event} />;
    case "streaming":
      return <StreamingRenderer event={event} />;
    case "presence":
    case "typing":
      return <PresenceRenderer event={event} />;
    default:
      return <GenericRenderer event={event} />;
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/debugger/src/components/center/renderers/
git commit -m "feat(debugger): add semantic event renderers for messages, streaming, presence"
```

---

### Task 12: Build EventCard and EventStream

**Files:**

- Create: `apps/debugger/src/components/center/EventCard.tsx`
- Create: `apps/debugger/src/components/center/EventStream.tsx`

- [ ] **Step 1: Create `apps/debugger/src/components/center/EventCard.tsx`**

```tsx
import { useState } from "react";
import type { DebugEvent } from "@/lib/types";
import { getEventCategory, CATEGORY_COLORS } from "@/lib/events";
import { formatTimestamp, formatBytes } from "@/lib/utils";
import { renderEventPreview } from "./renderers";
import { useEventStore } from "@/stores/events";

export function EventCard({ event }: { event: DebugEvent }) {
  const [showJson, setShowJson] = useState(false);
  const setSelectedEvent = useEventStore((s) => s.setSelectedEvent);
  const selectedEventId = useEventStore((s) => s.selectedEventId);

  const category = getEventCategory(event.eventName);
  const color = CATEGORY_COLORS[category];
  const isSelected = selectedEventId === event.id;
  const dirArrow = event.direction === "in" ? "↓" : "↑";

  return (
    <div
      className={`mx-2 mb-1.5 p-2 rounded-md border-l-[3px] cursor-pointer transition-colors ${
        isSelected
          ? "bg-slate-800 ring-1 ring-sky-500/50"
          : "bg-slate-900 hover:bg-slate-850"
      }`}
      style={{ borderLeftColor: color }}
      onClick={() => setSelectedEvent(isSelected ? null : event.id)}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold font-mono" style={{ color }}>
          {dirArrow} {event.eventName}
        </span>
        <div className="flex items-center gap-2 text-[10px] text-slate-500">
          {event.channelId && (
            <span className="font-mono">{event.channelId.slice(0, 8)}...</span>
          )}
          <span>{formatTimestamp(event.timestamp)}</span>
        </div>
      </div>

      {/* Semantic preview */}
      {renderEventPreview(event)}

      {/* Raw JSON toggle */}
      <div className="mt-1.5 flex items-center gap-2">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowJson(!showJson);
          }}
          className="text-[10px] text-slate-600 hover:text-slate-400"
        >
          {showJson ? "▼" : "▶"} Raw JSON ({formatBytes(event.meta?.size ?? 0)})
        </button>
      </div>

      {showJson && (
        <pre className="mt-1 p-2 bg-slate-950 rounded text-[10px] text-slate-400 font-mono overflow-x-auto max-h-48 overflow-y-auto">
          {JSON.stringify(event.payload, null, 2)}
        </pre>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create `apps/debugger/src/components/center/EventStream.tsx`**

```tsx
import { useRef, useEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEventStore } from "@/stores/events";
import { EventFilter } from "./EventFilter";
import { EventCard } from "./EventCard";

export function EventStream() {
  const filteredEvents = useEventStore((s) => s.getFilteredEvents());
  const parentRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  const virtualizer = useVirtualizer({
    count: filteredEvents.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80,
    overscan: 10,
  });

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    if (autoScrollRef.current && filteredEvents.length > 0) {
      virtualizer.scrollToIndex(filteredEvents.length - 1, {
        align: "end",
      });
    }
  }, [filteredEvents.length, virtualizer]);

  // Detect user scroll to disable auto-scroll
  const handleScroll = () => {
    const el = parentRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    autoScrollRef.current = atBottom;
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <EventFilter />
      <div
        ref={parentRef}
        className="flex-1 overflow-y-auto"
        onScroll={handleScroll}
      >
        {filteredEvents.length === 0 ? (
          <div className="flex items-center justify-center h-full text-sm text-slate-600">
            No events yet
          </div>
        ) : (
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const event = filteredEvents[virtualItem.index];
              return (
                <div
                  key={virtualItem.key}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                >
                  <EventCard event={event} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire center panel into App.tsx**

Replace `CenterPlaceholder` usage with:

```tsx
import { EventStream } from "@/components/center/EventStream";
```

And use `center={<EventStream />}`.

- [ ] **Step 4: Commit**

```bash
git add apps/debugger/src/components/center/ apps/debugger/src/App.tsx
git commit -m "feat(debugger): add EventStream with virtual scrolling and EventCard"
```

---

## Chunk 5: Right Panel (Actions)

### Task 13: Build QuickActions tab

**Files:**

- Create: `apps/debugger/src/components/right/QuickActions.tsx`

- [ ] **Step 1: Create `apps/debugger/src/components/right/QuickActions.tsx`**

```tsx
import { useState } from "react";
import { useConnectionStore } from "@/stores/connection";
import { emit } from "@/services/debug-socket";
import * as api from "@/services/api";
import { WS_EVENTS } from "@/lib/events";
import { nanoid } from "nanoid";

export function QuickActions() {
  const channels = useConnectionStore((s) => s.channels);
  const status = useConnectionStore((s) => s.status);
  const disabled = status !== "connected";

  // Send message state
  const [msgChannel, setMsgChannel] = useState("");
  const [msgContent, setMsgContent] = useState("");
  const [msgParentId, setMsgParentId] = useState("");
  const [sending, setSending] = useState(false);

  // Streaming state
  const [streamChannel, setStreamChannel] = useState("");
  const [streamContent, setStreamContent] = useState("");
  const [streamActive, setStreamActive] = useState(false);
  const [currentStreamId, setCurrentStreamId] = useState<string | null>(null);
  const [autoChunk, setAutoChunk] = useState(true);
  const [chunkInterval, setChunkInterval] = useState(500);
  const [includeThinking, setIncludeThinking] = useState(false);
  const [thinkingContent, setThinkingContent] = useState("");

  const handleSendMessage = async () => {
    if (!msgChannel || !msgContent) return;
    setSending(true);
    try {
      await api.sendMessage(msgChannel, msgContent, msgParentId || undefined);
      setMsgContent("");
      setMsgParentId("");
    } finally {
      setSending(false);
    }
  };

  const handleStartStream = async () => {
    if (!streamChannel) return;
    const streamId = nanoid();
    setCurrentStreamId(streamId);
    setStreamActive(true);

    emit(WS_EVENTS.STREAMING.START, {
      streamId,
      channelId: streamChannel,
    });

    if (autoChunk && streamContent) {
      // Auto-chunk mode: send thinking first if enabled, then split content
      if (includeThinking && thinkingContent) {
        emit(WS_EVENTS.STREAMING.THINKING_CONTENT, {
          streamId,
          channelId: streamChannel,
          content: thinkingContent,
        });
      }

      const words = streamContent.split(" ");
      let accumulated = "";
      for (let i = 0; i < words.length; i++) {
        accumulated += (i > 0 ? " " : "") + words[i];
        await new Promise((r) => setTimeout(r, chunkInterval));
        emit(WS_EVENTS.STREAMING.CONTENT, {
          streamId,
          channelId: streamChannel,
          content: accumulated,
        });
      }

      emit(WS_EVENTS.STREAMING.END, {
        streamId,
        channelId: streamChannel,
      });
      setStreamActive(false);
      setCurrentStreamId(null);
    }
    // In manual mode, user controls via End/Abort buttons
  };

  const handleEndStream = () => {
    if (!currentStreamId || !streamChannel) return;
    emit(WS_EVENTS.STREAMING.END, {
      streamId: currentStreamId,
      channelId: streamChannel,
    });
    setStreamActive(false);
    setCurrentStreamId(null);
  };

  const handleAbortStream = () => {
    if (!currentStreamId || !streamChannel) return;
    emit(WS_EVENTS.STREAMING.ABORT, {
      streamId: currentStreamId,
      channelId: streamChannel,
      reason: "cancelled",
    });
    setStreamActive(false);
    setCurrentStreamId(null);
  };

  const handleSendStreamChunk = () => {
    if (!currentStreamId || !streamChannel || !streamContent) return;
    emit(WS_EVENTS.STREAMING.CONTENT, {
      streamId: currentStreamId,
      channelId: streamChannel,
      content: streamContent,
    });
  };

  const ChannelSelect = ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (v: string) => void;
  }) => (
    <select
      className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs font-mono text-slate-200"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
    >
      <option value="">Select channel...</option>
      {channels.map((ch) => (
        <option key={ch.id} value={ch.id}>
          {ch.type === "direct" ? "DM" : "#"} {ch.name}
        </option>
      ))}
    </select>
  );

  return (
    <div className="p-3 space-y-4 text-xs">
      {/* Send Message */}
      <div>
        <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-2">
          Send Message (REST)
        </div>
        <div className="space-y-1.5">
          <ChannelSelect value={msgChannel} onChange={setMsgChannel} />
          <textarea
            className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-xs font-mono text-slate-200 resize-y h-12"
            placeholder="Message content..."
            value={msgContent}
            onChange={(e) => setMsgContent(e.target.value)}
            disabled={disabled}
          />
          <input
            className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs font-mono text-slate-200"
            placeholder="Parent ID (optional, for threads)"
            value={msgParentId}
            onChange={(e) => setMsgParentId(e.target.value)}
            disabled={disabled}
          />
          <button
            onClick={handleSendMessage}
            disabled={disabled || !msgChannel || !msgContent || sending}
            className="w-full py-1.5 bg-sky-700 rounded hover:bg-sky-600 disabled:opacity-40"
          >
            {sending ? "Sending..." : "Send Message"}
          </button>
        </div>
      </div>

      {/* Streaming */}
      <div>
        <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-2">
          Streaming (WebSocket)
        </div>
        <div className="space-y-1.5">
          <ChannelSelect value={streamChannel} onChange={setStreamChannel} />
          {includeThinking && (
            <textarea
              className="w-full bg-slate-950 border border-purple-700/50 rounded px-2 py-1.5 text-xs font-mono text-purple-300 resize-y h-10"
              placeholder="Thinking content..."
              value={thinkingContent}
              onChange={(e) => setThinkingContent(e.target.value)}
              disabled={disabled || streamActive}
            />
          )}
          <textarea
            className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-xs font-mono text-slate-200 resize-y h-16"
            placeholder="Streaming content..."
            value={streamContent}
            onChange={(e) => setStreamContent(e.target.value)}
            disabled={disabled}
          />
          <div className="flex gap-1">
            {!streamActive ? (
              <button
                onClick={handleStartStream}
                disabled={disabled || !streamChannel}
                className="flex-1 py-1.5 bg-amber-700 rounded hover:bg-amber-600 disabled:opacity-40"
              >
                ▶ Start Stream
              </button>
            ) : (
              <>
                {!autoChunk && (
                  <button
                    onClick={handleSendStreamChunk}
                    className="flex-1 py-1.5 bg-amber-700 rounded hover:bg-amber-600"
                  >
                    Send Chunk
                  </button>
                )}
                <button
                  onClick={handleEndStream}
                  className="flex-1 py-1.5 border border-slate-600 rounded hover:bg-slate-800"
                >
                  ⏹ End
                </button>
                <button
                  onClick={handleAbortStream}
                  className="py-1.5 px-2 bg-red-700 rounded hover:bg-red-600"
                >
                  ✕
                </button>
              </>
            )}
          </div>
          <div className="flex gap-3 text-[10px] text-slate-500">
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="checkbox"
                checked={autoChunk}
                onChange={(e) => setAutoChunk(e.target.checked)}
                disabled={streamActive}
              />
              Auto-chunk
            </label>
            {autoChunk && (
              <label className="flex items-center gap-1">
                <input
                  type="number"
                  className="w-14 bg-slate-950 border border-slate-700 rounded px-1 text-center"
                  value={chunkInterval}
                  onChange={(e) => setChunkInterval(Number(e.target.value))}
                  disabled={streamActive}
                  min={100}
                  step={100}
                />
                ms
              </label>
            )}
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="checkbox"
                checked={includeThinking}
                onChange={(e) => setIncludeThinking(e.target.checked)}
                disabled={streamActive}
              />
              Thinking
            </label>
          </div>
        </div>
      </div>

      {/* Quick Buttons */}
      <div>
        <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-2">
          Other Actions
        </div>
        <div className="grid grid-cols-2 gap-1">
          {[
            {
              label: "Typing Start",
              fn: () =>
                msgChannel &&
                emit(WS_EVENTS.TYPING.START, { channelId: msgChannel }),
            },
            {
              label: "Typing Stop",
              fn: () =>
                msgChannel &&
                emit(WS_EVENTS.TYPING.STOP, { channelId: msgChannel }),
            },
            {
              label: "Mark Read",
              fn: () =>
                msgChannel &&
                emit(WS_EVENTS.READ_STATUS.MARK_AS_READ, {
                  channelId: msgChannel,
                }),
            },
            {
              label: "Join Channel",
              fn: () =>
                msgChannel &&
                emit(WS_EVENTS.CHANNEL.JOIN, { channelId: msgChannel }),
            },
            {
              label: "Leave Channel",
              fn: () =>
                msgChannel &&
                emit(WS_EVENTS.CHANNEL.LEAVE, { channelId: msgChannel }),
            },
          ].map(({ label, fn }) => (
            <button
              key={label}
              onClick={fn}
              disabled={disabled}
              className="py-1.5 text-[10px] border border-slate-700 rounded hover:bg-slate-800 disabled:opacity-40"
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/debugger/src/components/right/QuickActions.tsx
git commit -m "feat(debugger): add QuickActions with message send and streaming simulation"
```

---

### Task 14: Build JsonEditor and Inspector tabs

**Files:**

- Create: `apps/debugger/src/components/right/JsonEditor.tsx`
- Create: `apps/debugger/src/components/right/Inspector.tsx`
- Create: `apps/debugger/src/components/right/ActionPanel.tsx`

- [ ] **Step 1: Create `apps/debugger/src/components/right/JsonEditor.tsx`**

```tsx
import { useState } from "react";
import { emit } from "@/services/debug-socket";
import { useConnectionStore } from "@/stores/connection";

const PRESETS: { label: string; eventName: string; payload: string }[] = [
  {
    label: "Join Channel",
    eventName: "join_channel",
    payload: '{\n  "channelId": ""\n}',
  },
  {
    label: "Leave Channel",
    eventName: "leave_channel",
    payload: '{\n  "channelId": ""\n}',
  },
  {
    label: "Mark as Read",
    eventName: "mark_as_read",
    payload: '{\n  "channelId": "",\n  "messageId": ""\n}',
  },
  {
    label: "Add Reaction",
    eventName: "add_reaction",
    payload: '{\n  "messageId": "",\n  "emoji": "👍"\n}',
  },
  {
    label: "Typing Start",
    eventName: "typing_start",
    payload: '{\n  "channelId": ""\n}',
  },
];

export function JsonEditor() {
  const status = useConnectionStore((s) => s.status);
  const disabled = status !== "connected";
  const [eventName, setEventName] = useState("");
  const [payload, setPayload] = useState("{}");
  const [error, setError] = useState<string | null>(null);

  const handleSend = () => {
    try {
      const parsed = JSON.parse(payload);
      setError(null);
      emit(eventName, parsed);
    } catch (e) {
      setError("Invalid JSON");
    }
  };

  const applyPreset = (preset: (typeof PRESETS)[0]) => {
    setEventName(preset.eventName);
    setPayload(preset.payload);
    setError(null);
  };

  return (
    <div className="p-3 space-y-3 text-xs">
      <div>
        <label className="text-[10px] text-slate-500 block mb-1">Presets</label>
        <div className="flex flex-wrap gap-1">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => applyPreset(p)}
              className="px-1.5 py-0.5 text-[10px] border border-slate-700 rounded hover:bg-slate-800"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-[10px] text-slate-500 block mb-1">
          Event Name
        </label>
        <input
          className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs font-mono text-slate-200 focus:border-sky-500 focus:outline-none"
          placeholder="e.g. join_channel"
          value={eventName}
          onChange={(e) => setEventName(e.target.value)}
          disabled={disabled}
        />
      </div>

      <div>
        <label className="text-[10px] text-slate-500 block mb-1">
          Payload (JSON)
        </label>
        <textarea
          className={`w-full bg-slate-950 border rounded px-2 py-1.5 text-xs font-mono text-slate-200 resize-y h-48 focus:outline-none ${
            error ? "border-red-500" : "border-slate-700 focus:border-sky-500"
          }`}
          value={payload}
          onChange={(e) => {
            setPayload(e.target.value);
            setError(null);
          }}
          disabled={disabled}
          spellCheck={false}
        />
        {error && (
          <div className="text-red-400 text-[10px] mt-0.5">{error}</div>
        )}
      </div>

      <button
        onClick={handleSend}
        disabled={disabled || !eventName}
        className="w-full py-1.5 bg-sky-700 rounded hover:bg-sky-600 disabled:opacity-40"
      >
        Send Event
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Create `apps/debugger/src/components/right/Inspector.tsx`**

```tsx
import { useEventStore } from "@/stores/events";
import { getEventCategory, CATEGORY_COLORS } from "@/lib/events";
import { formatTimestamp, formatBytes } from "@/lib/utils";

export function Inspector() {
  const selectedEventId = useEventStore((s) => s.selectedEventId);
  const events = useEventStore((s) => s.events);
  const event = events.find((e) => e.id === selectedEventId);

  if (!event) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-slate-600 p-4">
        Click an event in the stream to inspect it
      </div>
    );
  }

  const category = getEventCategory(event.eventName);
  const color = CATEGORY_COLORS[category];

  return (
    <div className="p-3 space-y-3 text-xs">
      <div>
        <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-1">
          Event
        </div>
        <div className="font-mono font-bold" style={{ color }}>
          {event.direction === "in" ? "↓" : "↑"} {event.eventName}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="text-[10px] text-slate-500">Time</div>
          <div className="font-mono">{formatTimestamp(event.timestamp)}</div>
        </div>
        <div>
          <div className="text-[10px] text-slate-500">Direction</div>
          <div>{event.direction === "in" ? "Received" : "Sent"}</div>
        </div>
        <div>
          <div className="text-[10px] text-slate-500">Size</div>
          <div className="font-mono">{formatBytes(event.meta?.size ?? 0)}</div>
        </div>
        <div>
          <div className="text-[10px] text-slate-500">Category</div>
          <div style={{ color }}>{category}</div>
        </div>
        {event.channelId && (
          <div className="col-span-2">
            <div className="text-[10px] text-slate-500">Channel</div>
            <div className="font-mono text-amber-400">{event.channelId}</div>
          </div>
        )}
        {event.meta?.streamId && (
          <div className="col-span-2">
            <div className="text-[10px] text-slate-500">Stream ID</div>
            <div className="font-mono text-amber-400">
              {event.meta.streamId}
            </div>
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <div className="text-[10px] text-slate-500 uppercase tracking-widest">
            Payload
          </div>
          <button
            onClick={() => {
              navigator.clipboard.writeText(
                JSON.stringify(event.payload, null, 2),
              );
            }}
            className="text-[10px] text-slate-500 hover:text-slate-300"
          >
            Copy
          </button>
        </div>
        <pre className="p-2 bg-slate-950 rounded text-[10px] text-slate-300 font-mono overflow-x-auto max-h-96 overflow-y-auto whitespace-pre-wrap">
          {JSON.stringify(event.payload, null, 2)}
        </pre>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `apps/debugger/src/components/right/ActionPanel.tsx`** — tab switcher

```tsx
import { useState } from "react";
import { QuickActions } from "./QuickActions";
import { JsonEditor } from "./JsonEditor";
import { Inspector } from "./Inspector";

const TABS = [
  { id: "actions", label: "Quick Actions" },
  { id: "json", label: "JSON Editor" },
  { id: "inspector", label: "Inspector" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function ActionPanel() {
  const [activeTab, setActiveTab] = useState<TabId>("actions");

  return (
    <div className="flex flex-col h-full">
      <div className="flex bg-slate-900 border-b border-slate-700">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 py-2 text-[11px] text-center ${
              activeTab === tab.id
                ? "text-sky-400 border-b-2 border-sky-400"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto">
        {activeTab === "actions" && <QuickActions />}
        {activeTab === "json" && <JsonEditor />}
        {activeTab === "inspector" && <Inspector />}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire right panel into App.tsx**

Replace `RightPlaceholder` with:

```tsx
import { ActionPanel } from "@/components/right/ActionPanel";
```

Use `right={<ActionPanel />}`.

- [ ] **Step 5: Commit**

```bash
git add apps/debugger/src/components/right/ apps/debugger/src/App.tsx
git commit -m "feat(debugger): add ActionPanel with QuickActions, JsonEditor, and Inspector"
```

---

## Chunk 6: Integration & Polish

### Task 15: Wire channel loading on connect

The DebugSocket `connect` function should fetch channels after authentication.

**Files:**

- Modify: `apps/debugger/src/services/debug-socket.ts`

- [ ] **Step 1: Update the `authenticated` handler in `debug-socket.ts`**

After `connStore.setStatus("connected")`, add channel loading:

```typescript
// Inside the WS_EVENTS.AUTH.AUTHENTICATED handler, after setStatus("connected"):
try {
  const channelsData = await getChannels();
  if (Array.isArray(channelsData)) {
    connStore.setChannels(
      channelsData.map((ch: Record<string, unknown>) => ({
        id: ch.id as string,
        name: (ch.name as string) ?? "unnamed",
        type: (ch.type as "direct" | "public" | "private") ?? "public",
        memberCount: ch.memberCount as number | undefined,
      })),
    );
  }
} catch (e) {
  console.warn("Failed to load channels:", e);
}
```

Add the import at top:

```typescript
import { getChannels } from "./api";
```

- [ ] **Step 2: Commit**

```bash
git add apps/debugger/src/services/debug-socket.ts
git commit -m "feat(debugger): auto-load channels after WebSocket authentication"
```

---

### Task 16: Final App.tsx assembly and verify

**Files:**

- Modify: `apps/debugger/src/App.tsx`

- [ ] **Step 1: Write final `App.tsx`**

```tsx
import { useEffect } from "react";
import { Layout } from "@/components/Layout";
import { useConnectionStore } from "@/stores/connection";
import { ConnectionPanel } from "@/components/left/ConnectionPanel";
import { ChannelList } from "@/components/left/ChannelList";
import { BotInfo } from "@/components/left/BotInfo";
import { EventStream } from "@/components/center/EventStream";
import { ActionPanel } from "@/components/right/ActionPanel";

function LeftPanel() {
  return (
    <>
      <ConnectionPanel />
      <ChannelList />
      <div className="flex-1" />
      <BotInfo />
    </>
  );
}

export function App() {
  const loadProfiles = useConnectionStore((s) => s.loadProfiles);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  return (
    <Layout
      left={<LeftPanel />}
      center={<EventStream />}
      right={<ActionPanel />}
    />
  );
}
```

- [ ] **Step 2: Run dev server and verify**

```bash
pnpm dev:debugger
```

Open `http://localhost:5174` — verify:

- Three-column layout renders
- Connection panel has URL and token inputs
- Event stream shows "No events yet"
- Action panel tabs switch between Quick Actions, JSON Editor, Inspector
- Top bar shows "disconnected" status
- Bottom bar shows event counts

- [ ] **Step 3: Commit**

```bash
git add apps/debugger/src/App.tsx
git commit -m "feat(debugger): finalize App assembly with all panels wired"
```

---

### Task 17: Add .gitignore for debugger build artifacts

**Files:**

- Create: `apps/debugger/.gitignore` (if needed — check if root .gitignore covers `dist/`)

- [ ] **Step 1: Check root .gitignore for dist coverage**

If root `.gitignore` already has `dist/` or `**/dist/`, skip creating a new one. Otherwise create:

```
dist/
node_modules/
```

- [ ] **Step 2: Add `.superpowers/` to root `.gitignore` if not already there**

Check if `.superpowers/` is in the root `.gitignore`. If not, add it.

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "chore(debugger): ensure build artifacts and brainstorm files are gitignored"
```

---

## Summary

| Task | Description                          | Files                                                                           |
| ---- | ------------------------------------ | ------------------------------------------------------------------------------- |
| 1    | Vite project scaffold                | package.json, vite.config, tsconfig, index.html, main.tsx, App.tsx, globals.css |
| 2    | Event constants + types              | lib/events.ts, lib/types.ts                                                     |
| 3    | EventStore (Zustand)                 | stores/events.ts                                                                |
| 4    | ConnectionStore (Zustand)            | stores/connection.ts                                                            |
| 5    | DebugSocket service                  | services/debug-socket.ts, lib/utils.ts                                          |
| 6    | REST API client                      | services/api.ts                                                                 |
| 7    | Layout shell + TopBar + BottomBar    | components/Layout.tsx, TopBar.tsx, BottomBar.tsx                                |
| 8    | ConnectionPanel                      | components/left/ConnectionPanel.tsx                                             |
| 9    | ChannelList + BotInfo                | components/left/ChannelList.tsx, BotInfo.tsx                                    |
| 10   | EventFilter bar                      | components/center/EventFilter.tsx                                               |
| 11   | Semantic renderers                   | components/center/renderers/\*.tsx                                              |
| 12   | EventCard + EventStream              | components/center/EventCard.tsx, EventStream.tsx                                |
| 13   | QuickActions                         | components/right/QuickActions.tsx                                               |
| 14   | JsonEditor + Inspector + ActionPanel | components/right/JsonEditor.tsx, Inspector.tsx, ActionPanel.tsx                 |
| 15   | Channel loading on connect           | services/debug-socket.ts update                                                 |
| 16   | Final App assembly                   | App.tsx final                                                                   |
| 17   | Gitignore cleanup                    | .gitignore                                                                      |

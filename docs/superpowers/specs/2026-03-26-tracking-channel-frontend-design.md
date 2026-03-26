# Tracking Channel Frontend Design

**Date:** 2026-03-26
**Status:** Draft
**Scope:** Agent execution tracking UI — inline card in group chat, modal detail view, real-time streaming, and supporting backend/agent-side changes.

---

## Overview

When a hive-managed bot is @mentioned in a group channel, the IM-Worker creates a tracking channel and a `tracking` type message in the original channel. This spec defines how that message renders as an inline card showing the latest 3 agent execution events, and how users can open a modal to view the full execution log with real-time streaming support.

**Key principle:** All infrastructure changes (streaming metadata, `channel:observe`, agent event metadata) are **generic** — they apply to any channel, not just tracking channels. DMs with bots, task channels, and tracking channels all use the same mechanisms. The only tracking-specific pieces are the inline card message type and the deactivation snapshot.

---

## 1. Data Model

### 1.1 Frontend Type Updates

```typescript
// types/im.ts
export type ChannelType = "direct" | "public" | "private" | "task" | "tracking";
export type MessageType = "text" | "file" | "image" | "system" | "tracking";

export interface Channel {
  // ...existing fields
  isActivated: boolean;
}
```

### 1.2 Agent Event Metadata (Generic)

Messages sent by agents in any channel can carry this metadata. Not tracking-specific — used in DMs, task channels, and tracking channels alike.

```typescript
interface AgentEventMetadata {
  agentEventType:
    | "thinking"
    | "writing"
    | "tool_call"
    | "tool_result"
    | "agent_start"
    | "agent_end"
    | "error"
    | "turn_separator";
  status: "running" | "completed" | "failed";
  toolName?: string; // tool_call / tool_result
  success?: boolean; // tool_result
}
```

Status flow:

- Streaming messages: `streaming_start` → `status: 'running'`, `streaming_end` → `status: 'completed'` (or `'failed'`)
- Non-streaming messages (agent_start, turn_separator, etc.): sent with `status: 'completed'` directly

### 1.3 Tracking Card Message Metadata

The `tracking` type message in the group channel carries:

```typescript
interface TrackingCardMetadata {
  trackingChannelId: string;
  triggerMessageId?: string;
  // No snapshot here — snapshot lives on the channel entity
}
```

One tracking channel may be referenced by multiple messages (e.g., forwarding), so the snapshot is stored at the channel level, not the message level.

### 1.4 Channel Snapshot (on deactivate)

Channels table gains a `snapshot` jsonb column. Written when `POST /channels/{id}/deactivate` is called. Applies to both tracking and task channels.

```typescript
interface ChannelSnapshot {
  totalMessageCount: number; // For "View N more details" display
  latestMessages: Array<{
    id: string;
    content: string;
    metadata: AgentEventMetadata;
    createdAt: string;
  }>;
}
```

---

## 2. Protocols

### 2.1 `channel:observe` / `channel:unobserve` (Generic)

Temporary, per-WebSocket-connection channel subscription for non-members.

```
Client → Server:  socket.emit('channel:observe', { channelId })
Client → Server:  socket.emit('channel:unobserve', { channelId })
```

Server behavior:

- **observe:** Validate permissions (user belongs to the same tenant as the channel), then `socket.join(channelId)`. Tenant-level check is simple and sufficient — can be tightened later if needed.
- **unobserve:** `socket.leave(channelId)`.
- **disconnect:** Socket.io automatically cleans up room membership.
- **reconnect:** Client re-sends all active observes (see 3.4).

This is a generic mechanism — not tracking-specific. Currently only used by tracking channels, but available for any future use case.

### 2.2 Streaming API Extension (Generic)

`StartStreamingDto` gains a `metadata` field:

```typescript
class StartStreamingDto {
  parentId?: string;
  metadata?: Record<string, unknown>; // NEW
}
```

The `streaming_start` WebSocket event broadcasts this metadata, so clients know the message type (thinking, writing, etc.) before content arrives. Generic extension — applies to all channels.

### 2.3 Initial Data Loading Strategy

Depends on tracking channel state:

| State                                  | Strategy                                                                                                                                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Active** (`isActivated: true`)       | `GET /im/channels/{id}` for channel info (including `isActivated`, `createdAt`), then `GET /im/channels/{id}/messages?limit=3` for latest messages, then `channel:observe` for real-time updates |
| **Deactivated** (`isActivated: false`) | `GET /im/channels/{id}` returns channel info with `snapshot` — zero extra message requests                                                                                                       |

### 2.4 Deactivate with Snapshot

When `POST /channels/{id}/deactivate` is called:

1. Set `isActivated = false`
2. Query latest 3 messages from the channel
3. Write to `snapshot` column on the channel
4. Broadcast `tracking:deactivated` event with snapshot payload

---

## 3. Frontend UI

### 3.1 Inline Card (Group Chat)

Renders when `message.type === 'tracking'`. The card displays:

**Header:**

- Bot avatar + name (left)
- Running time badge (right): blinking green dot + elapsed time when active, `✓ Xm Xs` when completed. Elapsed time computed client-side from tracking channel's `createdAt` timestamp (live-updating timer for active channels).

**Body:**

- Bot's initial response text (from message content)
- Timeline showing latest 3 agent execution events:
  - Status dot: green blinking = running, solid green = completed, solid red = failed
  - Type label: colored by status (green = completed, yellow = running, red = failed)
  - Content preview: truncated single line

**Frosted glass overlay:**

- When total messages > 3, the topmost (oldest) visible item is covered by a `backdrop-filter: blur(4px)` overlay
- "View N more details ›" text floats on the frost layer (N = `totalMessageCount - 3` for active channels via message count API, or from `snapshot.totalMessageCount - 3` for deactivated)
- When ≤ 3 messages, no frost overlay shown

**Interactions:**

- Entire card is clickable → opens modal
- Hover: background lightens, border appears, subtle shadow

### 3.2 Modal (Detail View)

Opens on card click. Full execution log view.

**Header:**

- Bot avatar + name + "Tracking Channel" subtitle
- Channel status indicator (running/completed)
- Close button

**Message list (scrollable):**

- All messages rendered by `agentEventType`:
  - `agent_start`: single-line with timestamp
  - `thinking`: collapsible — collapsed shows preview, expanded shows full reasoning text. Supports streaming with cursor animation.
  - `writing`: collapsible — streaming with cursor animation when running.
  - `tool_call`: single-line showing tool name in monospace
  - `tool_result`: collapsible — shows result preview, expandable for full output
  - `turn_separator`: horizontal divider with "Turn N" label
  - `error`: red-styled single-line
  - `agent_end`: single-line completion message
- Each item shows: status dot, type label, content, timestamp
- Status dots follow same color/animation rules as inline card

**Input area:**

- When `isActivated = true`: text input + send button for user guidance
- When `isActivated = false`: input disabled or hidden, read-only mode

**Streaming:**

- Active streaming messages show blinking cursor at text end
- Content updates in real-time via `streaming_content` events

### 3.3 Status Dot Specification

| Status    | Color             | Animation                              |
| --------- | ----------------- | -------------------------------------- |
| running   | `#00b894` (green) | Blink (opacity 1 → 0.3, 1.2s infinite) |
| completed | `#00b894` (green) | None (solid)                           |
| failed    | `#d63031` (red)   | None (solid)                           |

Type label colors:

- completed: green (`#00b894`)
- running: yellow (`#fdcb6e`)
- failed: red (`#d63031`)

### 3.4 Observe State Management

Frontend maintains an in-memory `Set<string>` of currently observed channel IDs.

```typescript
const observedChannels = new Set<string>();

socket.on("connect", () => {
  // Re-subscribe on reconnect (handles network blips)
  for (const channelId of observedChannels) {
    socket.emit("channel:observe", { channelId });
  }
});

function observe(channelId: string) {
  observedChannels.add(channelId);
  socket.emit("channel:observe", { channelId });
}

function unobserve(channelId: string) {
  observedChannels.delete(channelId);
  socket.emit("channel:unobserve", { channelId });
}
```

Lifecycle:

- Card enters viewport (or is rendered) with active tracking channel → `observe`
- Card leaves viewport / component unmounts → `unobserve`
- Modal opens → `observe` (if not already)
- Modal closes → `unobserve` (if card is not visible)

---

## 4. Agent-Side Changes (TrackingChannelObserver)

### 4.1 Current State

The `TrackingChannelObserver` in `team9-agent-pi` currently:

- Sends plain text messages without metadata
- Does not use the streaming API
- Only captures `tool_call_start/end`, `agent_start/end`, `error`
- Missing thinking and writing events

### 4.2 Required Changes

Use the same generic channel APIs as any other bot interaction:

| Agent Event          | agentEventType   | Delivery        | Status Flow         |
| -------------------- | ---------------- | --------------- | ------------------- |
| LLM starts reasoning | `thinking`       | Streaming API   | running → completed |
| LLM generates output | `writing`        | Streaming API   | running → completed |
| Tool invocation      | `tool_call`      | Regular message | completed           |
| Tool returns         | `tool_result`    | Regular message | completed / failed  |
| Execution starts     | `agent_start`    | Regular message | completed           |
| Execution ends       | `agent_end`      | Regular message | completed           |
| Turn boundary        | `turn_separator` | Regular message | completed           |
| Error                | `error`          | Regular message | failed              |

All messages carry `AgentEventMetadata` in the metadata field. Streaming messages use the extended `StartStreamingDto` with metadata.

---

## 5. Backend Changes

All changes are generic unless noted.

| Change                                         | Scope             | Description                                                         |
| ---------------------------------------------- | ----------------- | ------------------------------------------------------------------- |
| `StartStreamingDto` + `metadata`               | Generic           | Add optional `metadata` field, broadcast in `streaming_start` event |
| `channel:observe` / `channel:unobserve`        | Generic           | WebSocket handlers for temporary channel subscription               |
| `messageTypeEnum` + `'tracking'`               | Tracking-specific | New message type for inline card in group chat                      |
| `channels.snapshot` column                     | Tracking + Task   | JSONB column for deactivation snapshot                              |
| Deactivate writes snapshot                     | Tracking + Task   | Query latest 3 messages and write to snapshot on deactivate         |
| `tracking:deactivated` event includes snapshot | Tracking + Task   | Broadcast snapshot in deactivation event payload                    |

---

## 6. Mockups

Visual mockups are saved in `.superpowers/brainstorm/` directory:

- `tracking-card-v5.html` — Inline card with frosted glass overlay (approved)
- `tracking-modal.html` — Modal detail view with streaming (approved)

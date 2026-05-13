# Agent Session Bound Channel Panel Design

**Date:** 2026-05-11
**Status:** Draft, pending review
**Scope:** Team9 gateway + desktop client. No Team9 database migration in the first version.

## Problem

Team9 already has several channel types that effectively represent one agent
runtime session:

- Bot DM-style channels: `direct`, `routine-session`, `topic-session`
- Routine execution channels: `task`
- Group mention follow-up channels: `tracking`

The runtime session binding exists today, but it is implicit and spread across
message forwarding, routine execution, and topic-session creation logic. The
client therefore cannot render one consistent right-side panel for "the agent
session behind this channel".

The new feature adds a right-side panel that shows the bound agent session's
live status and selected component state. Component state must come from
agent-pi's session component data API, not from a Team9-maintained copy.

## Goals

- Resolve `channelId -> agent-pi session` for `direct`, `routine-session`,
  `topic-session`, `task`, and `tracking` channels.
- Show a unified right-side agent session panel for bound channels.
- Load the initial component view from agent-pi:
  `GET /api/sessions/:id/components`.
- Subscribe to agent-pi session events through a Team9 gateway proxy.
- Apply `component_data_snapshot` events directly to the client UI cache.
  Refetching is only for initial load, reconnect calibration, and unknown
  component metadata.
- Keep routine task timeline data sourced from Team9 / TaskCast while using
  agent-pi for runtime status and component state.

## Non-goals

- No new Team9 component-state persistence table in the first version.
- No direct browser access to agent-pi. Team9 remains the auth boundary.
- No raw component config exposure in the browser. Component configs can contain
  runtime wiring or secrets; the Team9 proxy returns a safe projection.
- No write controls for components in this version. The panel is read-only.
- No first-class OpenClaw component panel. OpenClaw-backed tasks show an
  unsupported runtime fallback until they expose an equivalent component API.

## Existing Model

### Channel Types

`im_channels.type` already includes the relevant values:

- `direct`
- `task`
- `tracking`
- `routine-session`
- `topic-session`

The channel row has `snapshot` and `propertySettings`, but no normalized
agent-session binding column.

### DM-style Sessions

`direct`, `routine-session`, and `topic-session` all collapse to agent-pi's
`dm` scope at the wire level:

```text
team9/{tenantId}/{agentId}/dm/{channelId}
```

`topic-session` additionally stores `propertySettings.topicSession.sessionId`
and `agentId`. `routine-session` stores `propertySettings.routineSession` and
the routine row stores `creationChannelId` / `creationSessionId`.

### Routine Execution Sessions

Hive routine execution creates a `task` channel, inserts a
`routine_executions` row with `channelId`, and creates the agent-pi session:

```text
team9/{tenantId}/{agentId}/routine/{executionId}
```

OpenClaw strategy does not create this agent-pi session and is not eligible for
the component panel.

### Tracking Sessions

Group bot mentions create a `tracking` channel. The runtime session id is:

```text
team9/{tenantId}/{agentId}/tracking/{trackingChannelId}
```

For this first version, the panel attaches when the user is viewing the
tracking channel itself. The original group channel only links to tracking via
message metadata and does not get a separate session panel for every tracking
placeholder.

### agent-pi Component Data

agent-pi exposes:

```http
GET /api/sessions/:id/components
```

The response contains `components[]` with component identity, effective config,
schema, and `latestData`. agent-pi also emits `component_data_snapshot` at the
end of each turn through:

```http
GET /api/sessions/:id/events
```

The Team9 client should use the snapshot event to update UI immediately.

## Approaches Considered

### A. Derive Binding On Read

Resolve session binding from current Team9 rows and deterministic session-id
rules each time the panel asks for it.

Pros:

- No migration.
- Matches current production behavior.
- Handles existing channels immediately.
- Keeps agent-pi as component state source of truth.

Cons:

- Resolver logic must know all existing channel variants.
- Historical inconsistencies need defensive fallbacks.

### B. Add `im_channel_agent_sessions`

Persist a normalized binding table for every future session-bound channel.

Pros:

- Clean read path.
- Easier analytics and cross-channel lookup later.

Cons:

- Requires migration and backfill.
- Still needs the derived resolver for old rows and repair.
- More moving parts before the panel can ship.

### C. Query agent-pi By `team9Context`

Ask agent-pi to search sessions by Team9 channel/execution metadata instead of
constructing session ids in Team9.

Pros:

- Makes agent-pi the complete session index.
- Could support future non-deterministic session ids.

Cons:

- Requires new agent-pi API semantics.
- Existing Team9 code already depends on deterministic session ids.

### Recommendation

Use approach A now. Add the resolver as a narrow service with tests. If future
features need analytics, cross-session search, or non-deterministic ids, add
approach B as an optimization while keeping the resolver as the compatibility
fallback.

## Backend Design

### New Binding Resolver

Add a gateway service under the IM module, for example:

```text
apps/server/apps/gateway/src/im/agent-sessions/agent-session-binding.service.ts
```

It exposes:

```ts
type AgentSessionBindingKind =
  | "dm"
  | "routine-creation"
  | "topic-session"
  | "routine-execution"
  | "tracking";

interface AgentSessionBindingResponse {
  channelId: string;
  channelType: string;
  kind: AgentSessionBindingKind;
  supported: boolean;
  unsupportedReason?: "no_bot" | "not_hive_managed" | "session_not_created";
  tenantId: string | null;
  agentId: string | null;
  botUserId: string | null;
  sessionId: string | null;
  routineId?: string;
  executionId?: string;
  taskcastTaskId?: string | null;
  taskStatus?: string;
}
```

Resolver rules:

- Authorize by channel membership before returning any binding.
- `direct`: find the bot member, read `bots.managedMeta.agentId`, derive
  `team9/{tenant}/{agent}/dm/{channelId}`.
- `routine-session`: prefer `routines.creationSessionId` when available,
  otherwise derive the same `dm/{channelId}` session id from the bot member.
- `topic-session`: prefer `propertySettings.topicSession.sessionId` and
  `agentId`; fallback to the deterministic `dm/{channelId}` format.
- `task`: join `routine_executions` by `channelId`, then `routines` and `bots`;
  only Hive-managed bots are supported. Session id is
  `team9/{tenant}/{agent}/routine/{executionId}`.
- `tracking`: find the bot member and derive
  `team9/{tenant}/{agent}/tracking/{channelId}`.

If the channel has no Hive-managed bot, return `supported: false` instead of a 500. This lets the panel show a clear fallback for OpenClaw or human-only
channels.

### Gateway API

Add a controller under:

```text
apps/server/apps/gateway/src/im/agent-sessions/
```

Endpoints:

```http
GET /v1/im/channels/:channelId/agent-session
GET /v1/im/channels/:channelId/agent-session/components
GET /v1/im/channels/:channelId/agent-session/events?token=...
```

`GET /agent-session` returns the binding response plus a best-effort
agent-pi status object for supported bindings:

```ts
interface AgentSessionStatus {
  exists: boolean;
  status?: "active" | "disposed";
  ownedBy?: string | null;
  queueLength?: number;
  activityState?: "active" | "inactive";
  unavailableReason?: "not_found" | "agent_pi_unavailable";
}
```

If the binding is supported but agent-pi returns 404, `exists` is `false` and
`unavailableReason` is `not_found`. If agent-pi is unreachable, the endpoint
still returns the Team9 binding with `exists: false` and
`unavailableReason: 'agent_pi_unavailable'` so the panel can render a stable
fallback instead of failing the whole channel view.

`GET /components` calls agent-pi `GET /api/sessions/:id/components`, then
returns a sanitized projection:

```ts
interface SafeSessionComponentItem {
  id: string;
  typeKey: string;
  runtimeInjectedOnly: boolean;
  schema?: unknown[];
  latestData: {
    data: Record<string, unknown>;
    capturedAtCallId: string | null;
    capturedAt: number;
  } | null;
}
```

The proxy intentionally omits `declaredConfig` and `effectiveConfig` from the
browser response. It also recursively redacts obvious sensitive keys in
`latestData.data`, including `token`, `secret`, `password`, `apiKey`,
`authorization`, and `credential`, case-insensitive.

`GET /events` proxies agent-pi `GET /api/sessions/:id/events`, but only
forwards events needed by the panel:

- `agent_start`
- `agent_end`
- `run_start`
- `run_end`
- `worker_release`
- `component_data_snapshot`
- `model_change`
- `thinking_level_change`
- `a2ui_surface_update`
- `a2ui_surface_delete`

All other events are dropped to avoid exposing raw conversation or tool payloads
through a generic panel stream. For forwarded `component_data_snapshot` events,
the gateway applies the same recursive sensitive-key redaction to every
`components[].data` payload before writing the SSE record to the browser.

### ClawHive Service

Extend `apps/server/libs/claw-hive/src/claw-hive.service.ts` with small typed
wrappers:

- `getSessionComponents(sessionId, tenantId?)`
- `getSessionStatus(sessionId, tenantId?)`

The SSE proxy can continue to stream with `fetch()` directly because it needs
low-level response-body control, matching the existing model-stream proxy.

## Frontend Design

### Hooks

Add:

```text
apps/client/src/hooks/useChannelAgentSession.ts
apps/client/src/hooks/useAgentSessionComponents.ts
```

`useChannelAgentSession(channelId)` loads the binding and exposes:

- `binding`
- `isSupported`
- `status`
- `refetch`

`useAgentSessionComponents(channelId, enabled)` loads the component snapshot and
opens the SSE stream. Initial query:

```http
GET /v1/im/channels/:channelId/agent-session/components
```

SSE:

```http
GET /v1/im/channels/:channelId/agent-session/events?token=...
```

### Direct UI Cache Patch

When the hook receives:

```ts
interface ComponentDataSnapshotEvent {
  type: "component_data_snapshot";
  sessionId: string;
  timestamp: number;
  turnIndex: number;
  components: Array<{ componentId: string; data: Record<string, unknown> }>;
}
```

it directly patches the React Query cache:

- Find component by `id === componentId`.
- Set `latestData.data` to the event data.
- Set `latestData.capturedAt` to event `timestamp`.
- Set `latestData.capturedAtCallId` to `null`.
- Preserve `schema` and `runtimeInjectedOnly`.
- If the component id is unknown, insert a temporary row:
  `{ id, typeKey: id, runtimeInjectedOnly: true, latestData }`, then refetch
  once to hydrate schema and metadata.

On SSE `open`, refetch once to close the "GET then subscribe" race. On SSE
`error`, keep the current panel state visible, reconnect, then refetch after the
next successful open.

Status events patch a lightweight status cache:

- `run_start` -> active, owned by event worker if present.
- `run_end` -> inactive.
- `agent_end` / disposed session -> ended.
- `worker_release` -> inactive unless queue length is known to be non-zero.

### Panel Component

Create a focused panel folder:

```text
apps/client/src/components/channel/agent-session/
```

Suggested components:

- `AgentSessionPanel.tsx`: layout, header, status, tab/section selection.
- `AgentSessionStatusHeader.tsx`: agent identity, session kind, activity.
- `SessionComponentList.tsx`: list of safe component rows.
- `SessionComponentRow.tsx`: summary plus collapsible latest data.
- `TaskContextSection.tsx`: task execution timeline for `task` channels.
- `TrackingContextSection.tsx`: tracking channel source / compact context.

Panel content:

1. Header: agent/session kind/status/model/thinking level when known.
2. Components: safe component rows, live-patched from SSE.
3. Context:
   - `task`: routine execution status + existing TaskCast-backed timeline.
   - `tracking`: source channel/trigger metadata when available, otherwise a
     compact "tracking session" context.
   - DM-like: no task timeline; show only session metadata and components.

### ChannelView Integration

`ChannelView` currently renders the message area and optional thread panels.
Add `AgentSessionPanel` as a right-side panel for supported bindings.

Panel ordering:

1. Main message column.
2. Agent session panel, when binding is supported.
3. Existing primary / secondary thread panels, when opened.

The existing width calculation should count the new panel so the message list
does not overlap with thread panels. On narrow viewports, the session panel can
collapse behind an icon button or be hidden until explicitly opened.

## Security and Privacy

- The browser never calls agent-pi directly.
- The gateway verifies JWT and channel membership for every snapshot and SSE
  request.
- The gateway forwards `X-Hive-Tenant` using the resolved channel tenant.
- Raw `declaredConfig` and `effectiveConfig` are not returned to the browser.
- Component data is recursively redacted by sensitive key names before it is
  sent to the client.
- SSE proxy uses an allowlist of event types. Conversation text, tool inputs,
  and tool outputs are not forwarded through this panel stream.

## Error Handling

- No binding: no panel.
- Unsupported binding: show a small "runtime details unavailable" panel with
  the reason.
- agent-pi session 404: show the binding and "session not created yet"; retry
  when new messages arrive or when the user manually refreshes.
- Components endpoint 502/503: keep panel shell, show retry button.
- SSE disconnect: keep last known component data, reconnect with backoff, then
  refetch components on reconnect.
- Unknown component from event: show temporary row immediately and refetch once.

## Testing

### Backend

- Resolver tests:
  - `direct` bot DM derives `dm/{channelId}`.
  - `topic-session` prefers `propertySettings.topicSession.sessionId`.
  - `routine-session` prefers `routines.creationSessionId`.
  - `task` joins `routine_executions.channelId` and derives
    `routine/{executionId}` for Hive bots.
  - OpenClaw task returns `supported: false`.
  - `tracking` derives `tracking/{channelId}`.
  - non-member user gets 403.
- Components proxy tests:
  - calls agent-pi `GET /api/sessions/:id/components`.
  - strips `declaredConfig` / `effectiveConfig`.
  - redacts sensitive keys in `latestData.data`.
- SSE proxy tests:
  - forwards allowlisted events.
  - drops non-allowlisted events.
  - accepts JWT through `?token=` for browser `EventSource`.

### Frontend

- `useAgentSessionComponents` tests:
  - initial GET populates component rows.
  - `component_data_snapshot` directly patches `latestData`.
  - unknown component inserts a temporary row and schedules refetch.
  - reconnect refetches but keeps old data visible.
- `AgentSessionPanel` tests:
  - supported binding renders status and components.
  - unsupported binding renders fallback.
  - task binding renders task context section.
  - tracking binding renders tracking context section.
- `ChannelView` integration test:
  - bound bot DM shows session panel.
  - human DM does not show session panel.
  - thread panels still open without overlapping the session panel container.

## Rollout

1. Ship resolver and read-only proxy endpoints.
2. Ship front-end panel guarded by `binding.supported`; unsupported bindings
   render the fallback panel instead of enabling the live component stream.
3. Enable for Hive-backed DM-like, task, and tracking channels.
4. Leave OpenClaw unsupported fallback visible but non-blocking.

## Future Follow-ups

- Whether to add a persistent `im_channel_agent_sessions` table for analytics
  or historical repair.
- Whether selected known components should get bespoke renderers instead of
  generic safe JSON rows.
- Whether original group channels should aggregate all tracking session panels
  related to their messages.

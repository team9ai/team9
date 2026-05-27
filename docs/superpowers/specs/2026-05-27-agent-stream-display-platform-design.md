# Agent Stream Display Platform Design

Date: 2026-05-27

## Summary

Coffice is a new product line centered on office objects, primarily documents and spreadsheets. The first product loop should support create, edit, and analyze runs over those objects. Coffice should be a separate product repository and service, while agent-pi remains the shared agent runtime.

The reusable platform work should live in the agent-pi monorepo as frontend stream display packages. The shared layer should focus on consuming and rendering agent stream state. It must not extract Team9's existing backend forwarding layer in the first phase, because Team9 already has product-specific NestJS proxy controllers for authentication, workspace/channel/routine access checks, and SSE forwarding. Coffice may either read agent-pi directly or add its own proxy later.

The shared packages must provide Team9 parity. They are not a simplified streaming demo. They must be able to support Team9's current agent conversation stream, task execution stream, aHand runtime output stream, model/session component updates, folding behavior, raw event access, and long-list performance requirements.

## Goals

- Create reusable agent stream display packages in agent-pi.
- Preserve Team9's existing stream display behavior when Team9 migrates.
- Support Coffice object-centric agent run panels without importing Team9's IM, channel, routine, or task model.
- Separate event transport from stream consumption and rendering.
- Support custom renderers for agent messages, user messages, tool calls, artifacts, runtime output, A2UI surfaces, raw events, and product-specific events.
- Make folding, virtual scrolling, scroll anchoring, and long-output handling first-class shared capabilities.

## Non-Goals

- Do not extract Team9's backend SSE proxy controllers in the first phase.
- Do not move Team9 business models into shared packages.
- Do not force Team9 to replace its message list shell, channel UI, avatars, thread actions, reactions, read status, permissions, or product navigation.
- Do not force Coffice into Team9's chat/message model.
- Do not make the shared UI package the only way to render stream state. The reducer and controller must be usable with fully custom UI.

## Product Direction

Coffice should treat documents and spreadsheets as the main objects. Chat is an input and context mechanism, not the main product object.

The first Coffice run types are:

- `create`: generate a document or spreadsheet from a goal.
- `edit`: modify an existing document or spreadsheet through structured changes.
- `analyze`: summarize, inspect, or extract findings from a document or spreadsheet.

The first object carrier strategy is file-driven with a lightweight internal editor:

- File-driven: upload, parse, generate, export, version, and compare files such as docx, xlsx, csv, and markdown.
- Lightweight editor: preview generated content, inspect changes, and accept or reject proposed modifications.
- External integrations are a later adapter layer for Google Docs, Sheets, Office, or Feishu.

## Repository Boundary

The packages should be added to the agent-pi monorepo, not Team9:

```text
team9-agent-pi/packages/
  stream-display-core/
  stream-display-react/
  stream-display-ui/
  stream-source-eventsource/
```

Initial package names should use the agent-pi namespace:

```text
@team9claw/stream-display-core
@team9claw/stream-display-react
@team9claw/stream-display-ui
@team9claw/stream-source-eventsource
```

No `stream-forwarder-nest` or `stream-forwarder-hono` package is needed for the first phase.

Team9 keeps its current forwarding layer:

- `RoutinesStreamController` for TaskCast execution stream proxying.
- `AhandJobStreamController` for aHand job output proxying.
- `AgentSessionController` for agent-pi session event proxying.
- `ChannelModelController` and related controllers for Team9-specific model/session metadata streams.

Coffice can either:

- connect directly to agent-pi session events/history, or
- expose its own Coffice API proxy later for office-object permissions, audit, redaction, and integration credentials.

## Layering

The shared architecture is:

```text
Event source
  agent-pi, TaskCast, Team9 gateway, Coffice API, or future source
        |
Source abstraction
        |
Event adapters
        |
Core reducer
        |
Display controller
        |
Default UI or custom renderers
```

Responsibilities:

- Source: fetch history and subscribe to live events.
- Adapter: normalize raw events into canonical stream events.
- Core reducer: update normalized stream state.
- Display controller: derive display items, folding state, virtualized item metadata, and scroll behavior.
- UI: render default components while allowing product-specific slots.

## Source Abstraction

The source contract should not assume URL shape, JWT query params, Team9 headers, Coffice auth, or direct agent-pi access.

```ts
export interface StreamSource {
  loadHistory?: () => Promise<unknown[]>;
  subscribeLive: (handlers: StreamSourceHandlers) => StreamSubscription;
}

export interface StreamSourceHandlers {
  onEvent: (event: unknown, meta?: StreamEventMeta) => void;
  onError: (error: StreamSourceError) => void;
  onStatus?: (status: StreamConnectionStatus) => void;
}

export interface StreamSubscription {
  close: () => void;
}

export interface StreamEventMeta {
  id?: string;
  eventName?: string;
  receivedAt: number;
  source?: string;
}
```

`stream-source-eventsource` should implement this abstraction for EventSource:

- build URL through a caller-provided function.
- get tokens through a caller-provided function.
- pass `Last-Event-ID` when configured.
- expose connection status.
- support reconnect with caller-controlled policy.
- ignore heartbeat/ping records by default.
- avoid assuming Team9's `?token=` convention.

## Event Adapters

Adapters convert raw event shapes to canonical events:

```ts
export interface StreamEventAdapter {
  name: string;
  canHandle: (event: unknown, meta?: StreamEventMeta) => boolean;
  normalize: (
    event: unknown,
    meta?: StreamEventMeta,
  ) => NormalizedStreamEvent[];
}
```

Initial adapters:

- `agentPiEventAdapter`: agent-pi native events such as `turn_start`, `message_update`, `tool_call_end`, `a2ui_surface_update`, `llm_call_end`, `model_change`, and `component_data_snapshot`.
- `taskcastRunEventAdapter`: Team9 TaskCast execution events such as `step`, `deliverable`, `intervention`, and `status_changed`.
- `runtimeOutputAdapter`: aHand-style runtime events such as `job.stdout`, `job.stderr`, `job.progress`, `job.finished`, `job.error`, and `job.resync`.
- `customEventAdapter`: extension point for Coffice diff, spreadsheet patch, artifact preview, external integration status, or product-specific events.

Adapters must preserve raw event access for debug panels and product-specific renderers.

## Core State

The core package should reduce normalized events into state that is UI-friendly but not product-specific:

```ts
export interface StreamState {
  turns: StreamTurn[];
  timeline: StreamTimelineItem[];
  artifacts: StreamArtifact[];
  interventions: StreamIntervention[];
  runtimeOutputs: StreamRuntimeOutput[];
  surfaces: StreamA2UISurface[];
  rawEvents: NormalizedStreamEvent[];
  status: StreamLifecycleStatus;
}

export type StreamLifecycleStatus =
  | "idle"
  | "connecting"
  | "live"
  | "reconnecting"
  | "paused"
  | "terminal"
  | "error";
```

The reducer must support:

- history plus live merge.
- event deduplication by stable IDs and fallback keys.
- `message_update` latest semantics by message ID.
- tool call lifecycle aggregation.
- thinking content as first-class blocks.
- reply stream start/delta/end.
- A2UI surface update/delete.
- LLM call metadata as raw/runtime detail, not forced into chat UI.
- unknown events retained and renderable.

## Display Controller

The display controller should produce stable display items:

```ts
export type StreamDisplayItem =
  | { kind: "user-message"; id: string; turnId: string; data: unknown }
  | { kind: "agent-message"; id: string; turnId: string; data: unknown }
  | { kind: "thinking"; id: string; turnId: string; data: unknown }
  | { kind: "tool-call"; id: string; turnId: string; data: unknown }
  | { kind: "runtime-output"; id: string; data: unknown }
  | { kind: "artifact"; id: string; data: unknown }
  | { kind: "intervention"; id: string; data: unknown }
  | { kind: "a2ui"; id: string; data: unknown }
  | { kind: "status"; id: string; data: unknown }
  | { kind: "raw-event"; id: string; data: unknown }
  | { kind: "custom"; id: string; type: string; data: unknown };
```

It must also manage display state:

```ts
export interface StreamDisplayState {
  collapsed: Record<string, boolean>;
  pinnedItems: string[];
  visibleRange?: { start: number; end: number };
  autoScrollMode: "stick-to-bottom" | "preserve-position" | "manual";
}
```

Required behavior:

- Auto-collapse older execution rounds while leaving the latest active round expanded.
- Preserve stable collapse state when virtualized rows unmount and remount.
- Support independent folding for tool calls, thinking blocks, raw events, LLM calls, A2UI surfaces, runtime logs, artifacts, and custom items.
- Support dynamic height changes after expand/collapse.
- Keep scroll anchored when the user is inspecting older history.
- Follow the latest output only when the user is already near the bottom.
- Truncate or fold very large JSON, stdout/stderr, tool result, and raw event payloads by default while allowing full inspection.
- Expose controls to custom renderers so custom UI still participates in folding, measuring, and scroll behavior.

## React Package

`stream-display-react` should expose:

```ts
export function useAgentStream(
  options: UseAgentStreamOptions,
): AgentStreamResult;

export interface UseAgentStreamOptions {
  streamKey: string;
  source: StreamSource;
  adapters: StreamEventAdapter[];
  reducerOptions?: StreamReducerOptions;
  displayOptions?: StreamDisplayOptions;
}
```

It should also expose lower-level hooks:

- `useStreamReducer`
- `useStreamDisplayController`
- `useStreamVirtualizer`
- `useAutoScrollController`
- `useCollapseState`

This lets Team9 adopt only the state layer first, while Coffice can adopt the full list controller.

## UI Package

`stream-display-ui` should provide default components, but all important content must be replaceable:

```tsx
<AgentStreamView
  state={state}
  controller={controller}
  renderUserMessage={renderUserMessage}
  renderAgentMessage={renderAgentMessage}
  renderThinking={renderThinking}
  renderToolCall={renderToolCall}
  renderRuntimeOutput={renderRuntimeOutput}
  renderArtifact={renderArtifact}
  renderIntervention={renderIntervention}
  renderA2UI={renderA2UI}
  renderStatus={renderStatus}
  renderRawEvent={renderRawEvent}
  renderUnknownEvent={renderUnknownEvent}
  renderCustom={renderCustom}
/>
```

Default renderers should cover:

- user and assistant messages.
- thinking blocks.
- tool call status, args, result, error, duration, and raw events.
- runtime output with stdout/stderr/progress/finished/error/resync.
- artifacts and deliverables.
- interventions and approvals.
- raw event inspector.
- A2UI surfaces.
- LLM call detail summaries.

Products can replace any renderer without opting out of shared folding, virtualization, or scroll anchoring.

## Team9 Integration

Team9 should migrate through composition, not replacement of the full message product UI:

```tsx
<Team9MessageList>
  <RegularTeam9Messages />
  <AgentStreamList
    state={streamState}
    renderItem={(item, controls) => (
      <Team9AgentStreamItem item={item} controls={controls} />
    )}
  />
</Team9MessageList>
```

Team9 keeps ownership of:

- channel message shell.
- avatars and sender identity.
- thread and reply UI.
- reactions and message operations.
- read state and presence.
- channel activation/read-only state.
- workspace and tenant permissions.
- routine/task/staff/agent hub navigation.
- Team9-specific tool cards, links, and i18n.
- ordinary non-agent message rendering.

The shared package owns:

- stream state.
- normalized agent and run display items.
- folding controls.
- virtual list support.
- scroll anchoring.
- default fallback renderers.

## Coffice Integration

Coffice should not consume Team9's channel/message model. It should use the stream packages like this:

```tsx
<OfficeObjectView object={documentOrSheet} />

<AgentRunPanel>
  <AgentStreamList
    state={streamState}
    renderItem={(item, controls) => (
      <CofficeRunEvent item={item} controls={controls} />
    )}
  />
</AgentRunPanel>
```

Coffice custom adapters and renderers should cover:

- document draft generation.
- spreadsheet creation and analysis.
- proposed document changes.
- spreadsheet patches.
- artifact previews.
- accept/reject change workflows.
- file version events.
- external integration status when added later.

## Team9 Parity Requirements

The shared packages must support the following existing Team9 behaviors before Team9 migrates production UI:

Agent conversation stream:

- `turn_start` and `turn_end`.
- `message_start`, `message_update`, and `message_end`.
- user and assistant message projection.
- thinking blocks.
- `reply_stream_start`, `reply_stream_delta`, and `reply_stream_end`.
- raw event retention.

Tool calls:

- `tool_call_start`, `tool_call_update`, and `tool_call_end`.
- tool args and partial/raw argument display.
- result, error state, duration, token/cost metadata when available.
- friendly views for product-specific tools through slots.

Execution events:

- step timeline.
- deliverables/artifacts.
- interventions/approvals.
- status changes.
- TaskCast history/live behavior.

Runtime output:

- aHand stdout.
- aHand stderr.
- progress.
- finished/error states.
- resync/history-trimmed style events.
- terminal job behavior that stops reconnecting.

Runtime metadata:

- `llm_call_start` and `llm_call_end`.
- `model_change`.
- `thinking_level_change`.
- `component_data_snapshot`.
- `a2ui_surface_update` and `a2ui_surface_delete`.
- `compaction`.
- `error`.

Display and performance:

- execution round grouping.
- old execution round auto-folding.
- latest active round expanded.
- tool/thinking/raw/A2UI/LLM call folding.
- virtual scrolling for long streams.
- dynamic row measurement after expansion.
- scroll position preservation while reading history.
- automatic bottom follow only when appropriate.
- truncation or folding for huge JSON/log/result bodies.

Product UI:

- Team9 custom message chrome remains replaceable through slots.
- Team9-only rendering is not forced into shared package defaults.

## Migration Plan

Phase 1: Extract agent-pi dashboard stream core.

- Move current `useChatStream` and `chatReducer` logic into `stream-display-core` and `stream-display-react`.
- Preserve agent-pi dashboard behavior through wrappers.
- Add unit tests around reducer parity.

Phase 2: Add display controller.

- Add display item derivation, folding state, virtual item metadata, and scroll controller hooks.
- Port current dashboard collapsible behaviors for messages, tools, raw events, LLM calls, A2UI, and session components.
- Add tests for collapse state stability and item identity.

Phase 3: Add Team9 adapters.

- Normalize Team9 TaskCast execution events.
- Normalize aHand job output events.
- Normalize agent-pi session events proxied through Team9.
- Add fixture-based tests using representative Team9 raw events.

Phase 4: Team9 shadow migration.

- Keep Team9 backend forwarding unchanged.
- Route one low-risk stream surface through shared state while preserving current UI.
- Compare output against existing components and tests.
- Expand to execution timeline, aHand output, agent-session components, and model/session streams.

Phase 5: Coffice implementation.

- Build object-centric run panel on top of shared packages.
- Add Coffice adapters for document/spreadsheet diff, patch, artifact, and file-version events.
- Keep Coffice transport independent: direct agent-pi first if acceptable, Coffice proxy later if object-level security requires it.

## Testing Strategy

Core tests:

- reducer handles history plus live merge.
- duplicate events are ignored.
- `message_update` latest replacement is stable.
- tool call lifecycle aggregates correctly.
- unknown events are retained.
- adapters preserve raw event references.

Display tests:

- stable IDs across repeated reductions.
- round grouping matches Team9 visible-step count semantics.
- collapse state survives item reordering and virtual unmount/remount.
- latest round auto-fold behavior matches Team9.
- large payloads default to collapsed/truncated state.

React tests:

- EventSource source reconnects with caller-provided token strategy.
- `Last-Event-ID` is passed when available.
- heartbeat/ping records do not corrupt state.
- terminal status can stop reconnecting.
- history unavailable can fall back to live-only mode.

Team9 parity tests:

- Use fixtures from current Team9 streams for task execution, agent session events, aHand job output, and model/session component updates.
- Migrate UI tests incrementally with visual behavior preserved.

Coffice tests:

- Document run events render without Team9 message shell.
- Spreadsheet analysis events render as run panel items.
- custom renderer receives controls for folding and measurement.

## Risks

Over-extracting Team9 business UI:

- Mitigation: shared packages expose slots and generic stream items only. Team9 product renderers stay in Team9.

Under-extracting display mechanics:

- Mitigation: folding, virtual scrolling, and auto-scroll live in shared controller, not product pages.

Transport coupling:

- Mitigation: source abstraction only. No Team9 gateway, Coffice API, or agent-pi URL assumptions in core/react/ui packages.

Team9 parity drift:

- Mitigation: Team9 fixtures and shadow migration before replacement.

Virtualization complexity with custom renderers:

- Mitigation: expose measurement controls to renderers and use stable item IDs.

## Open Questions

- Which virtualizer should the UI package use by default, or should it expose a virtualizer adapter interface first?
- Should `stream-display-ui` depend on the existing dashboard UI primitives, or should it ship headless primitives plus optional styled defaults?
- Should Team9's friendly tool views move into Team9-only renderer modules, or should some generic host/runtime tool views live in `stream-display-ui`?
- What exact Coffice event schema should represent document diffs and spreadsheet patches?

## Approval Gate

This design should be reviewed before implementation planning. After approval, the next step is a concrete implementation plan for the agent-pi packages and the Team9 parity migration sequence.

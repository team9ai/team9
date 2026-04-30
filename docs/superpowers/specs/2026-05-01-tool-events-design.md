# Tool Events Display Standard Design

## Context

Team9 currently renders agent tool activity from persisted `tool_call` and
`tool_result` agent-event messages. The UI pairs adjacent messages by
`toolCallId` and renders them with `ToolCallBlock`.

Three problems need to be solved together:

1. Some tool failures are rendered as successful calls because the UI mainly
   checks `metadata.status === "failed"` and does not consistently honor
   structured failure data such as `success: false` or `{ error: ... }` in the
   result payload.
2. Tool calls do not stream visibly while arguments are being generated or
   execution is pending. Users often see no useful progress until the final
   result message exists.
3. Long tool arguments or results may be truncated either by compact UI
   summaries or by server-side `long_text` preview truncation. Expanded views
   should show the same complete content the agent produced.

The chosen approach is a compatible standardization of tool lifecycle events,
not a full rewrite of the agent event model.

## Goals

- Define one tool event contract for Team9 tools.
- Make success/failure display deterministic across tools.
- Show running tool calls as soon as a call starts, including streaming
  argument updates.
- Keep compact rows readable while guaranteeing expanded rows can show full
  arguments and results.
- Preserve compatibility with existing persisted `tool_call` and `tool_result`
  messages.

## Non-Goals

- Do not replace the entire `AgentEventMetadata` model.
- Do not migrate historical database rows.
- Do not redesign the visual style of tracking rows beyond what is needed for
  status accuracy, streaming, and full expanded content.
- Do not change unrelated routine execution behavior.

## Event Contract

Tool activity is represented by a lifecycle over one `toolCallId`.

### `tool_call`

Emitted when the model starts describing or invoking a tool. It may contain
partial arguments.

```ts
interface ToolCallEventMetadata {
  agentEventType: "tool_call";
  status: "running";
  toolCallId: string;
  toolName: string;
  toolArgs?: Record<string, unknown>;
  toolArgsText?: string;
  startedAt: string;
}
```

### `tool_delta`

Emitted while arguments or execution state change. To preserve compatibility,
the first implementation may encode this as `agentEventType: "tool_call"` plus
`toolPhase`, or add `"tool_delta"` to the metadata union if that is lower risk
after implementation planning.

```ts
interface ToolDeltaEventMetadata {
  agentEventType: "tool_delta";
  status: "running";
  toolCallId: string;
  toolName: string;
  toolArgs?: Record<string, unknown>;
  toolArgsText?: string;
  toolPhase: "args_streaming" | "executing";
  updatedAt: string;
}
```

### `tool_result`

Emitted once the tool finishes, fails, is cancelled, or times out. `success` is
required for newly emitted events.

```ts
interface ToolResultEventMetadata {
  agentEventType: "tool_result";
  status: "completed" | "failed" | "cancelled" | "timeout";
  success: boolean;
  toolCallId: string;
  toolName?: string;
  errorCode?: string;
  errorMessage?: string;
  resultTruncated?: boolean;
  fullContentMessageId?: string;
  completedAt: string;
}
```

## Success And Failure Semantics

The UI uses one normalization helper to derive display state.

Priority order:

1. `tool_result.success === false` means failure, regardless of `status`.
2. `status` of `failed`, `cancelled`, or `timeout` means non-success.
3. For legacy result content, if parsed JSON contains a top-level
   `success: false`, `error`, or `errorMessage`, display failure.
4. A running call without a result displays running.
5. A completed result without failure evidence displays success.

This lets tools return formatted failure content without accidentally producing
a green checkmark.

## Streaming Behavior

The UI should render a tool card as soon as the call starts.

- While args are streaming, show the tool name and current argument text or
  structured args.
- While execution is pending after args are complete, keep the row in running
  state and show an executing label.
- When the final result arrives, merge the final result into the same card.
- If a persisted `tool_result` arrives before a matching `tool_call`, keep the
  existing defensive behavior and render it as a standalone event until pairing
  data exists.

The first implementation should reuse existing WebSocket/streaming paths where
possible, adding only the smallest event extension needed for tool deltas.

## Full Content And Truncation

There are two valid truncation layers:

- Compact UI summaries can truncate one-line labels and argument summaries.
- Server previews for `long_text` messages can truncate persisted message
  content for list performance.

Expanded tool panels must not be limited by either layer.

Rules:

- Full `toolArgs` are displayed in the expanded args section when available.
- `toolArgsText` is displayed when structured args are incomplete or still
  streaming.
- If the result message is `long_text` or carries `isTruncated`, the expanded
  result section fetches `/full-content` and renders that content.
- If the final metadata carries `resultTruncated` and `fullContentMessageId`,
  the expanded result section fetches that full content target.
- Compact summaries may continue using `formatParams`, but the expanded panel
  uses the original data.

## Frontend Changes

- Add a tool event normalization helper that accepts call metadata, optional
  delta metadata, result metadata, and result content.
- Update `ToolCallBlock` to render from normalized state.
- Update `TrackingEventItem` or its caller path so running `tool_call` items use
  the same normalized display logic as paired calls.
- Update `TrackingCard`, `TrackingModal`, and `MessageList` pairing paths to
  share the same helper.
- Add regression tests for:
  - `success: false` with `status: "completed"` renders failure.
  - Wrapped result content containing `success:false` renders failure.
  - A running tool call without result renders a running tool card.
  - Streaming argument updates replace the visible running args.
  - Expanded long result loads full content when the preview is truncated.

## Backend And Agent Changes

- Introduce a small server-side helper for building tool event metadata.
- Ensure newly emitted `tool_result` metadata always includes `success`.
- Standardize exception handling in the tool wrapper:
  - thrown exceptions become `success:false`, `status:"failed"`, and
    `errorMessage`;
  - business failures returned by tools are normalized to `success:false`;
  - successful returns are normalized to `success:true`.
- Emit running call metadata before a long tool begins execution.
- Emit argument deltas while the model is streaming tool arguments when the
  upstream provider exposes them.
- Preserve old event names and existing `tool_call` / `tool_result` message
  shape so current persisted rows remain renderable.

## Compatibility

Existing rows are supported by fallback parsing:

- Missing `success` falls back to status and result-content inspection.
- Missing `toolName` falls back to the call metadata, then `"Unknown tool"`.
- Missing structured args falls back to `toolArgsText`, then compact content.

No migration is required for historical messages.

## Open Implementation Notes

- During planning, inspect where base-model and OpenClaw agents currently emit
  tool events. If only one path emits tool events, standardize there first.
- Decide whether `tool_delta` should become a new `AgentEventMetadata` union
  member or be represented as `tool_call` with a `toolPhase` field for the
  first iteration.
- Keep unrelated `apps/server/apps/gateway/src/routines/*` working tree changes
  out of the implementation commit unless explicitly requested.

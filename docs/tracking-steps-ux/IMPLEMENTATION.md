# Agent Tracking Steps UX Implementation Guide

Implementation reference for the agent execution step display optimization.

**Related spec:** [2026-04-09-tracking-steps-ux-optimization.md](../superpowers/specs/2026-04-09-tracking-steps-ux-optimization.md)

## Overview

This document covers the extensible configuration points and architecture of the agent execution step display system. It is intended for engineers who need to:

- Add new tool labels for friendly display
- Configure parameter summarization for new tools
- Understand the round auto-fold logic in DM channels
- Migrate label configuration from the frontend to the agent side
- Extend the Thinking event display (tokens / duration)

## Architecture

The system is organized in three layers:

```
Agent side (team9-agent-pi)
  └── TrackingChannelObserver
        │
        │ Sends tracking channel messages with agentEventType metadata
        │ (thinking, tool_call, tool_result, agent_start, agent_end, error)
        │
        ▼
Backend (team9 gateway)
  └── IM worker persists messages to database
        │
        │ Messages returned to frontend via WebSocket / REST
        │
        ▼
Frontend (team9 client)
  ├── config/ ........................ (i18n keys + param configs)
  │     ├── toolLabels.ts (Task 1)
  │     └── toolParamConfig.ts (Task 2)
  │
  ├── hooks/ ......................... (state management)
  │     └── useTrackingFold.ts (Task 3)
  │
  ├── lib/ ........................... (pure functions)
  │     └── round-grouping.ts (Task 7a)
  │
  └── components/channel/ ............ (UI)
        ├── TrackingEventItem.tsx (Tasks 4, 6.3)
        ├── ToolCallBlock.tsx (Task 5)
        ├── RoundCollapseSummary.tsx (Task 7b)
        ├── MessageList.tsx (Task 7c)
        ├── TrackingCard.tsx (Task 9)
        └── BotThinkingIndicator.tsx (Task 10)
```

## Extension Points

### 1. Adding a new tool label

Tool labels are driven by `apps/client/src/config/toolLabels.ts`. It exposes `getLabelKey(operationType, toolName, status)` which returns an i18n key descriptor. The resolution order is:

1. **Tool-specific label** (highest priority) — `toolNameLabelKeys[toolName]`
2. **Operation label** — `operationLabelKeys[operationType]`
3. **Generic fallback** — `tracking.ops.fallback.{status}` with `{name}` interpolation

**To add a new tool** (e.g. `create_task`):

**Step 1 —** Add the key mapping in `apps/client/src/config/toolLabels.ts`:

```typescript
const toolNameLabelKeys: Record<string, string> = {
  // existing entries ...
  create_task: "tracking.tools.createTask",
};
```

**Step 2 —** Add the English translations to `apps/client/src/i18n/locales/en/channel.json`:

```json
{
  "tracking": {
    "tools": {
      "createTask": {
        "loading": "Creating task",
        "success": "Task created",
        "error": "Failed to create task"
      }
    }
  }
}
```

**Step 3 —** Add the Chinese translations to `apps/client/src/i18n/locales/zh/channel.json`:

```json
{
  "tracking": {
    "tools": {
      "createTask": {
        "loading": "正在创建任务",
        "success": "任务创建完成",
        "error": "任务创建失败"
      }
    }
  }
}
```

No component changes needed — `TrackingEventItem`, `ToolCallBlock`, and `TrackingCard` already resolve labels through `getLabelKey` + `useTranslation("channel")`.

### 2. Adding parameter summarization for a new tool

Tool parameters are summarized by `apps/client/src/config/toolParamConfig.ts`. Each tool can specify `keyParams` (which fields to show) and optional `truncate` limits.

**To add a new tool** (e.g. `CreateTask`):

```typescript
export const toolParamConfig: Record<string, ToolParamConfigItem> = {
  // existing entries ...
  CreateTask: {
    keyParams: ["title", "description"],
    truncate: { description: 80 },
  },
};
```

**Display format:** `CreateTask(title="Fix bug", description="Short description here...(52 more)")`

**Fallback behavior:** If a tool isn't in the config, `formatParams` falls back to `JSON.stringify(params)` which is verbose but safe.

**Note:** The `toolParamConfig` uses **PascalCase** tool names (the names the LLM uses in actual tool invocations), not the snake_case used in `toolNameLabels`. These are two separate concerns:

- `toolLabels.ts` uses snake_case keys because it maps operation event metadata coming from the agent (`agentEventType: "tool_call"`, `toolName: "send_message"`).
- `toolParamConfig.ts` uses PascalCase keys because it matches the LLM tool invocation name (`SendToChannel`, `SearchDocs`).

This is a known inconsistency — future work may unify them via mapping metadata.

### 3. Extending Thinking event display

Thinking events use the extended `AgentEventMetadata` fields (see Task 6.1):

```typescript
interface AgentEventMetadata {
  // ... existing fields
  thinking?: string; // the thinking content text
  inputTokens?: number; // input token count
  outputTokens?: number; // output token count
  totalTokens?: number; // total tokens (usually input + output)
  durationMs?: number; // elapsed milliseconds
  startedAt?: string; // ISO timestamp (for live-updating elapsed display)
}
```

`TrackingEventItem` reads these fields and renders `Thinking (1200 tokens, 2m 3s)` with automatic singular/plural handling via i18next.

To adjust the format, edit the i18n keys:

- `tracking.thinking.label` — bare "Thinking" label when no stats
- `tracking.thinking.labelWithStats` — format with `{{stats}}` interpolation
- `tracking.thinking.tokens_one` / `tokens_other` — token count format
- `tracking.thinking.seconds` — seconds-only duration
- `tracking.thinking.minutesSeconds` — minutes + seconds duration

## Round Auto-Fold Logic (Task 7)

### Concept

A **round** is a contiguous block of agent event messages (thinking, tool_call, tool_result, agent_start, agent_end, error, etc.) sent by the agent before any non-agent-event message. Rounds are separated by non-agent messages (text replies from the bot, user messages, etc.).

### Rules

1. **Only DM channels fold** — other channel types (`tracking`, `task`, `public`, `private`) never fold.
2. **The latest round is always expanded** — the last round in the message list (whose following content has no non-agent message after it) stays fully visible so the user can see in-progress execution.
3. **Non-latest rounds auto-fold** — when a reply or any non-agent event appears after a round, that round automatically collapses into a `RoundCollapseSummary` button.
4. **User expansion persists** — when the user clicks the summary button to expand a folded round, the round stays expanded even as new messages arrive. State is held in `userExpandedRounds: Set<string>`.
5. **State resets on channel switch** — `userExpandedRounds` is cleared when `channelId` changes to prevent stale IDs from accumulating.

### Pure function: `groupMessagesByRound`

Located at `apps/client/src/lib/round-grouping.ts`. Input is a chronological `Message[]`, output is `RoundGroupItem[]`:

```typescript
type RoundGroupItem =
  | { type: "message"; message: Message }
  | {
      type: "round";
      roundId: string; // id of the first message in the round
      messages: Message[]; // all messages in this round
      isLatest: boolean; // true if no non-agent message follows
      stepCount: number; // messages.length
    };
```

The function is pure and deterministic — it only depends on the input array, does not mutate it, and handles edge cases like unknown metadata shapes and empty inputs.

### MessageList integration

`MessageList.tsx` calls `computeRoundFoldMaps` (from `message-list-fold.ts`) to derive two maps:

- `roundStateMap: Map<roundId, { isFolded, firstMessageId, stepCount }>` — which rounds should show a summary
- `messageRoundMap: Map<messageId, roundId>` — lookup which folded round a message belongs to

Inside `itemContent`, `decideRoundRender` checks each message:

- `{ kind: "summary" }` — render `RoundCollapseSummary` (the round's first message position)
- `{ kind: "hidden" }` — render a 1px `aria-hidden` placeholder (subsequent messages in a folded round)
- `{ kind: "none" }` — render normally (the default path)

Placeholders keep Virtuoso item keys stable so scroll positions don't jump when folding/unfolding.

## Agent Side (team9-agent-pi)

The `TrackingChannelObserver` in `packages/claw-hive/src/runtime/tracking-channel-observer.ts` emits events to the tracking channel. Task 6.2 added thinking + LLM usage forwarding:

### Thinking event emission

1. **On `message_end`** — extract thinking text blocks from `message.content` (via `extractThinkingFromBlocks`) and stash in `pendingThinking`.
2. **On `llm_call_end`** — if `pendingThinking` is set, emit a `sendMessage` with `agentEventType: "thinking"` metadata including:
   - `thinking` — the extracted text
   - `inputTokens`, `outputTokens`, `totalTokens` — from `event.usage`
   - `durationMs` — from `event.durationMs`
   - `startedAt` — computed as `new Date(event.timestamp - event.durationMs).toISOString()`
3. **Error isolation** — `pendingThinking` is cleared _before_ the await so a failed send cannot leak stale state into the next round.

## Future Agent-Side Takeover

The current `toolLabels.ts` and `toolParamConfig.ts` configurations live in the frontend. The long-term plan is for the agent side to provide these as part of its tool metadata, supporting:

- Per-tool localized labels emitted by the agent with each event
- Language-aware selection based on the user's current locale
- Tool registry metadata driven by the agent components

### Migration path

**Phase 1 (current):** Frontend holds all label mappings in `toolLabels.ts` / `toolParamConfig.ts`.

**Phase 2 (planned):** Agent includes label hints in `AgentEventMetadata`:

```typescript
interface AgentEventMetadata {
  // ... existing fields
  labelOverrides?: {
    en?: { loading: string; success: string; error: string };
    zh?: { loading: string; success: string; error: string };
  };
}
```

Frontend checks `labelOverrides[currentLang]` first, then falls back to `getLabelKey`.

**Phase 3 (future):** Agent emits complete i18n-aware labels for all locales, and the frontend config becomes purely a fallback for unknown tools.

## Testing Patterns

### Unit tests

Each pure helper has its own unit test with 100% coverage:

- `toolLabels.test.ts` — key resolution and fallback
- `toolParamConfig.test.ts` — parameter formatting and truncation
- `useTrackingFold.test.ts` — fold state management
- `round-grouping.test.ts` — round boundary detection
- `message-list-fold.test.ts` — fold map computation

### Component tests

Components use real i18n (`test-setup.ts` imports `@/i18n`) so assertions can check actual translated English strings:

```typescript
expect(screen.getByText("Thinking (1200 tokens, 2m 3s)")).toBeInTheDocument();
expect(screen.getByText("Message sent")).toBeInTheDocument();
expect(
  screen.getByRole("button", { name: /Expand execution process \(3 steps\)/i }),
).toBeInTheDocument();
```

Language can be switched mid-test with `i18n.changeLanguage("zh")` wrapped in `act()`.

### End-to-end integration test

`tracking-ux-integration.test.tsx` (Task 11) renders the real `MessageList` + tracking components with real i18n, walking through a 5-phase user flow:

1. Round 1 in progress — fully expanded
2. Round 1 reply arrives — round folds to summary
3. Round 2 starts — round 1 stays folded, round 2 expands
4. User clicks summary — round 1 re-expands
5. Round 2 completes — user's round 1 expansion is preserved

This test catches regressions across Tasks 1-10 in a single flow.

## Related Files

- **Spec:** [docs/superpowers/specs/2026-04-09-tracking-steps-ux-optimization.md](../superpowers/specs/2026-04-09-tracking-steps-ux-optimization.md)
- **Plan:** [docs/superpowers/plans/2026-04-09-tracking-steps-ux-optimization.md](../superpowers/plans/2026-04-09-tracking-steps-ux-optimization.md)
- **Agent side:** `team9-agent-pi/packages/claw-hive/src/runtime/tracking-channel-observer.ts`

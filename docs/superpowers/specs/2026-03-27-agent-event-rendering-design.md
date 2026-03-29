# Agent Event Message Rendering in DM/Task Channels

**Date:** 2026-03-27

## Problem

In DM and task channels, bot messages with `agentEventType` metadata (tool calls, tool results, thinking, writing, etc.) are rendered as plain text or raw JSON. They should use the structured `TrackingEventItem` component (status dot + label + content).

## Design

### Detection

In `MessageItem`, check `message.metadata?.agentEventType`:

```typescript
function getAgentMeta(message: Message): AgentEventMetadata | undefined {
  const meta = message.metadata as Record<string, unknown> | undefined;
  if (meta && typeof meta.agentEventType === "string") {
    return meta as unknown as AgentEventMetadata;
  }
  return undefined;
}
```

### Rendering Rules

**Agent event messages** (isAgentEvent = true):

- No avatar, no sender name, no timestamp
- Rendered with `TrackingEventItem`
- Wrapped in a container with left green border + subtle green background (agent event block)
- `tool_result` and `thinking` types: content collapsed by default, shows summary + `...` + chevron `›`, click to expand
- `thinking` type: purple label color (`text-purple-400`), expanded content has purple-tinted background
- All other types: normal TrackingEventItem display

**Alignment (from mockup):**

- Agent event block: `margin-left: 16px` (left border aligned with avatar left edge), `padding-left: 13px` (dot center at avatar center ~34px)
- Status dot: `margin-right: 26px` — so label starts at 64px from container, aligned with message text
- Label: fixed `width: 72px` — all content columns align
- Expanded content block: full width within the agent event block

**Spacing / grouping logic:**

- New prop `prevMessage?: Message` on MessageItem
- If current message is agent event AND previous is also agent event → no extra top margin (tight grouping)
- If current is first agent event in group → small top margin to separate from preceding normal message
- User text messages and bot final text messages have normal spacing with avatar

### Collapsible Behavior

`TrackingEventItem` gains a `collapsible?: boolean` prop:

- When `collapsible = true`: shows truncated summary (60 chars) + `...` in the row, with a chevron icon
- Click toggles expanded content block below the row
- `thinking`: expanded block has `bg-purple-500/5 border-purple-500/20`, italic text
- `tool_result`: expanded block has `bg-black/30 border-border`, mono font

### Files Changed

| File                         | Change                                                                                                                                                               |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MessageItem.tsx`            | Import `TrackingEventItem` + `AgentEventMetadata`, add `getAgentMeta()` helper, add `prevMessage` prop, add agent event rendering branch before system message check |
| `TrackingEventItem.tsx`      | Add `collapsible` prop, `useState` for expand/collapse, chevron icon, expanded content block, purple label for thinking, `truncateLine` helper                       |
| `MessageList.tsx`            | Pass `prevMessage` to `MessageItem` / `ChannelMessageItem` in render callback                                                                                        |
| `TrackingEventItem.test.tsx` | Update tests for new `collapsible` prop behavior                                                                                                                     |

### Not Changed

- TrackingCard / TrackingModal: unaffected
- Group chat message flow: unaffected (agent events don't appear in group chat directly)
- Backend: no changes

### Mockup

Visual reference at `.superpowers/brainstorm/dm-agent-events/content/dm-mockup.html`

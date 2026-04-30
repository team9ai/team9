# Tool Events Standard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standardize Team9 tool-call events so failed tools display as failed, running tools appear before final results, and expanded tool details show complete arguments/results.

**Architecture:** Add a shared frontend normalization layer for tool event display, then route `ToolCallBlock`, `MessageList`, `TrackingCard`, and `TrackingEventItem` through it. Add a server-side metadata normalizer at message ingestion so new `tool_result` messages consistently include `success`, `errorMessage`, and related standard fields while preserving existing `tool_call` / `tool_result` rows.

**Tech Stack:** React 19, TypeScript, Vitest, NestJS, Drizzle-backed IM messages, Socket.io streaming events.

---

## File Structure

- Create `apps/client/src/lib/tool-events.ts`
  - Frontend-only helper for unwrapping result content, detecting legacy failures, deriving display status, and building stable display data for `ToolCallBlock`.
- Create `apps/client/src/lib/__tests__/tool-events.test.ts`
  - Unit coverage for success/failure priority, wrapped result parsing, running state, and arg text fallback.
- Modify `apps/client/src/types/im.ts`
  - Extend `AgentEventMetadata` with optional `toolArgsText`, `toolPhase`, `errorCode`, `errorMessage`, `resultTruncated`, `fullContentMessageId`, `completedAt`, and `updatedAt`.
- Modify `apps/client/src/lib/agent-event-metadata.ts`
  - Preserve the new optional metadata fields when normalizing tracking snapshots.
- Modify `apps/client/src/components/channel/ToolCallBlock.tsx`
  - Render from `buildToolDisplayState()`, support optional result metadata/content, show running cards, and fetch full result content on expand when a result message is truncated.
- Modify `apps/client/src/components/channel/__tests__/ToolCallBlock.test.tsx`
  - Add regression coverage for `success:false`, wrapped legacy failures, running calls, streamed arg text, and full-content fetch.
- Modify `apps/client/src/components/channel/MessageList.tsx`
  - Render standalone running `tool_call` messages with `ToolCallBlock`, not generic `TrackingEventItem`.
- Modify `apps/client/src/components/channel/TrackingCard.tsx`
  - Render unpaired active/running `tool_call` items with `ToolCallBlock`.
- Modify `apps/server/apps/gateway/src/im/messages/utils/tool-event-metadata.ts`
  - Server helper that standardizes tool-result metadata at ingestion.
- Modify `apps/server/apps/gateway/src/im/messages/messages.controller.ts`
  - Normalize metadata before sending create-message requests to im-worker.
- Add `apps/server/apps/gateway/src/im/messages/utils/tool-event-metadata.spec.ts`
  - Unit coverage for status/success normalization and legacy result parsing.
- Modify `docs/superpowers/specs/2026-05-01-tool-events-design.md` only if implementation discovers a deliberate contract change.

Keep existing uncommitted `apps/server/apps/gateway/src/routines/*` changes out of all commits for this plan.

---

### Task 1: Frontend Tool Event Normalization

**Files:**

- Create: `apps/client/src/lib/tool-events.ts`
- Create: `apps/client/src/lib/__tests__/tool-events.test.ts`
- Modify: `apps/client/src/types/im.ts`
- Modify: `apps/client/src/lib/agent-event-metadata.ts`

- [ ] **Step 1: Extend `AgentEventMetadata` types**

In `apps/client/src/types/im.ts`, add these optional fields after `toolArgs?: Record<string, unknown>;`:

```ts
  toolArgsText?: string;
  toolPhase?: "args_streaming" | "executing";
```

Add these optional result fields after `success?: boolean;`:

```ts
  errorCode?: string;
  errorMessage?: string;
  resultTruncated?: boolean;
  fullContentMessageId?: string;
  completedAt?: string;
  updatedAt?: string;
```

- [ ] **Step 2: Preserve new fields in snapshot metadata normalization**

In `apps/client/src/lib/agent-event-metadata.ts`, add these spreads inside the returned object in `getAgentEventMetadata()`:

```ts
    ...(typeof value.toolArgsText === "string"
      ? { toolArgsText: value.toolArgsText }
      : {}),
    ...(value.toolPhase === "args_streaming" || value.toolPhase === "executing"
      ? { toolPhase: value.toolPhase }
      : {}),
    ...(typeof value.errorCode === "string"
      ? { errorCode: value.errorCode }
      : {}),
    ...(typeof value.errorMessage === "string"
      ? { errorMessage: value.errorMessage }
      : {}),
    ...(typeof value.resultTruncated === "boolean"
      ? { resultTruncated: value.resultTruncated }
      : {}),
    ...(typeof value.fullContentMessageId === "string"
      ? { fullContentMessageId: value.fullContentMessageId }
      : {}),
    ...(typeof value.completedAt === "string"
      ? { completedAt: value.completedAt }
      : {}),
    ...(typeof value.updatedAt === "string" ? { updatedAt: value.updatedAt } : {}),
```

- [ ] **Step 3: Write failing normalization tests**

Create `apps/client/src/lib/__tests__/tool-events.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildToolDisplayState, unwrapToolResultContent } from "../tool-events";
import type { AgentEventMetadata } from "@/types/im";

function callMeta(
  overrides: Partial<AgentEventMetadata> = {},
): AgentEventMetadata {
  return {
    agentEventType: "tool_call",
    status: "running",
    toolCallId: "tc-1",
    toolName: "send_message",
    toolArgs: { message: "hello" },
    ...overrides,
  };
}

function resultMeta(
  overrides: Partial<AgentEventMetadata> = {},
): AgentEventMetadata {
  return {
    agentEventType: "tool_result",
    status: "completed",
    toolCallId: "tc-1",
    success: true,
    ...overrides,
  };
}

describe("unwrapToolResultContent", () => {
  it("unwraps text blocks from tool result content wrappers", () => {
    const raw = JSON.stringify({
      content: [{ type: "text", text: '{"success":false}' }],
      details: {},
    });

    expect(unwrapToolResultContent(raw)).toBe('{"success":false}');
  });
});

describe("buildToolDisplayState", () => {
  it("treats success false as failure even when status is completed", () => {
    const state = buildToolDisplayState({
      callMetadata: callMeta(),
      resultMetadata: resultMeta({ success: false }),
      resultContent: '{"ok":false}',
    });

    expect(state.status).toBe("error");
    expect(state.isError).toBe(true);
    expect(state.indicator).toBe("cross");
  });

  it("detects legacy wrapped success false payloads as failure", () => {
    const wrapped = JSON.stringify({
      content: [{ type: "text", text: '{"success":false,"error":"denied"}' }],
    });

    const state = buildToolDisplayState({
      callMetadata: callMeta(),
      resultMetadata: resultMeta({ success: undefined }),
      resultContent: wrapped,
    });

    expect(state.status).toBe("error");
    expect(state.errorMessage).toBe("denied");
  });

  it("renders a missing result as running", () => {
    const state = buildToolDisplayState({
      callMetadata: callMeta({ toolArgsText: '{"message":"hel' }),
    });

    expect(state.status).toBe("loading");
    expect(state.isRunning).toBe(true);
    expect(state.argsText).toBe('{"message":"hel');
  });

  it("uses completed result as success when no failure evidence exists", () => {
    const state = buildToolDisplayState({
      callMetadata: callMeta(),
      resultMetadata: resultMeta({ success: true }),
      resultContent: '{"success":true}',
    });

    expect(state.status).toBe("success");
    expect(state.isSuccess).toBe(true);
    expect(state.indicator).toBe("check");
  });
});
```

- [ ] **Step 4: Run the failing frontend tests**

Run:

```bash
pnpm -C apps/client test src/lib/__tests__/tool-events.test.ts
```

Expected: fail because `apps/client/src/lib/tool-events.ts` does not exist.

- [ ] **Step 5: Implement `tool-events.ts`**

Create `apps/client/src/lib/tool-events.ts`:

```ts
import { formatParams } from "@/config/toolParamConfig";
import type { StatusType } from "@/config/toolLabels";
import type { AgentEventMetadata } from "@/types/im";

export type ToolIndicator = "check" | "cross" | "none";

export interface ToolDisplayState {
  toolName: string;
  status: StatusType;
  isRunning: boolean;
  isError: boolean;
  isSuccess: boolean;
  indicator: ToolIndicator;
  argsSummary: string;
  argsText: string;
  resultText: string;
  errorMessage?: string;
}

interface BuildToolDisplayStateInput {
  callMetadata: AgentEventMetadata;
  resultMetadata?: AgentEventMetadata;
  resultContent?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function unwrapToolResultContent(raw = ""): string {
  const parsed = tryParseJson(raw);
  if (isRecord(parsed) && Array.isArray(parsed.content)) {
    const texts = parsed.content
      .filter((block): block is { type: string; text: string } => {
        return (
          isRecord(block) &&
          block.type === "text" &&
          typeof block.text === "string"
        );
      })
      .map((block) => block.text);
    if (texts.length > 0) return texts.join("\n");
  }
  return raw;
}

function findFailure(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  if (payload.success === false) {
    if (typeof payload.errorMessage === "string") return payload.errorMessage;
    if (typeof payload.error === "string") return payload.error;
    return "Tool returned success=false";
  }
  if (typeof payload.errorMessage === "string") return payload.errorMessage;
  if (typeof payload.error === "string") return payload.error;
  return undefined;
}

function detectLegacyFailure(resultText: string): string | undefined {
  const parsed = tryParseJson(resultText);
  return findFailure(parsed);
}

function formatArgs(toolName: string, metadata: AgentEventMetadata): string {
  if (metadata.toolArgs) return formatParams(toolName, metadata.toolArgs);
  return metadata.toolArgsText ?? "";
}

export function buildToolDisplayState({
  callMetadata,
  resultMetadata,
  resultContent = "",
}: BuildToolDisplayStateInput): ToolDisplayState {
  const toolName =
    callMetadata.toolName ?? resultMetadata?.toolName ?? "Unknown tool";
  const resultText = unwrapToolResultContent(resultContent);
  const explicitFailure =
    resultMetadata?.success === false ||
    resultMetadata?.status === "failed" ||
    resultMetadata?.status === "cancelled" ||
    resultMetadata?.status === "timeout";
  const legacyFailure = resultText
    ? detectLegacyFailure(resultText)
    : undefined;
  const errorMessage =
    resultMetadata?.errorMessage ?? legacyFailure ?? undefined;

  const status: StatusType =
    !resultMetadata || resultMetadata.status === "running"
      ? "loading"
      : explicitFailure || legacyFailure
        ? "error"
        : "success";

  return {
    toolName,
    status,
    isRunning: status === "loading",
    isError: status === "error",
    isSuccess: status === "success",
    indicator:
      status === "success" ? "check" : status === "error" ? "cross" : "none",
    argsSummary: formatArgs(toolName, callMetadata),
    argsText: callMetadata.toolArgs
      ? JSON.stringify(callMetadata.toolArgs, null, 2)
      : (callMetadata.toolArgsText ?? ""),
    resultText,
    ...(errorMessage ? { errorMessage } : {}),
  };
}
```

- [ ] **Step 6: Run normalization tests until green**

Run:

```bash
pnpm -C apps/client test src/lib/__tests__/tool-events.test.ts
```

Expected: pass with 4 tests.

- [ ] **Step 7: Commit Task 1**

Run:

```bash
git add apps/client/src/types/im.ts apps/client/src/lib/agent-event-metadata.ts apps/client/src/lib/tool-events.ts apps/client/src/lib/__tests__/tool-events.test.ts
git commit -m "feat(client): normalize tool event display state"
```

Expected: commit includes only the four frontend normalization files.

---

### Task 2: ToolCallBlock Uses Normalized State And Full Result Content

**Files:**

- Modify: `apps/client/src/components/channel/ToolCallBlock.tsx`
- Modify: `apps/client/src/components/channel/__tests__/ToolCallBlock.test.tsx`

- [ ] **Step 1: Add failing tests for failure priority and running state**

In `apps/client/src/components/channel/__tests__/ToolCallBlock.test.tsx`, add these tests under `describe("status indicators", ...)`:

```tsx
it("shows failure when result success is false even if status is completed", () => {
  render(
    <ToolCallBlock
      callMetadata={makeCallMeta("RunScript")}
      resultMetadata={makeResultMeta("completed", { success: false })}
      resultContent='{"success":false,"error":"script failed"}'
    />,
  );

  expect(screen.getByText("Tool call failed")).toBeInTheDocument();
  expect(screen.getByText("\u2718")).toBeInTheDocument();
  expect(screen.queryByText("\u2714")).not.toBeInTheDocument();
});

it("shows failure when wrapped legacy result content has success false", () => {
  const wrappedContent = JSON.stringify({
    content: [
      {
        type: "text",
        text: '{"success":false,"error":"permission denied"}',
      },
    ],
  });

  render(
    <ToolCallBlock
      callMetadata={makeCallMeta("RunScript")}
      resultMetadata={makeResultMeta("completed", { success: undefined })}
      resultContent={wrappedContent}
    />,
  );

  expect(screen.getByText("Tool call failed")).toBeInTheDocument();
  expect(screen.getByText("\u2718")).toBeInTheDocument();
});

it("renders a running tool call without result metadata", () => {
  render(
    <ToolCallBlock
      callMetadata={makeCallMeta("RunScript", undefined, {
        status: "running",
        toolArgsText: '{"cmd":"pnpm test',
      })}
      resultContent=""
    />,
  );

  expect(screen.getByText("Calling tool")).toBeInTheDocument();
  expect(screen.queryByText("\u2714")).not.toBeInTheDocument();
  expect(screen.queryByText("\u2718")).not.toBeInTheDocument();
  expect(screen.getByText(/RunScript/)).toBeInTheDocument();
});
```

Update the local helper signatures in the same test file:

```ts
function makeCallMeta(
  toolName: string,
  toolArgs?: Record<string, unknown>,
  overrides: Partial<AgentEventMetadata> = {},
): AgentEventMetadata {
  return {
    agentEventType: "tool_call",
    status: "completed",
    toolName,
    toolCallId: "tc-1",
    toolArgs,
    ...overrides,
  };
}

function makeResultMeta(
  status: "completed" | "failed" | "running" = "completed",
  overrides: Partial<AgentEventMetadata> = {},
): AgentEventMetadata {
  return {
    agentEventType: "tool_result",
    status,
    success: status === "completed",
    toolCallId: "tc-1",
    ...overrides,
  };
}
```

- [ ] **Step 2: Run failing ToolCallBlock tests**

Run:

```bash
pnpm -C apps/client test src/components/channel/__tests__/ToolCallBlock.test.tsx
```

Expected: the new `success:false` and missing-result tests fail.

- [ ] **Step 3: Update ToolCallBlock props and normalized rendering**

In `apps/client/src/components/channel/ToolCallBlock.tsx`, change the props:

```ts
interface ToolCallBlockProps {
  callMetadata: AgentEventMetadata;
  resultMetadata?: AgentEventMetadata;
  resultContent?: string;
  resultMessage?: Pick<
    Message,
    "id" | "type" | "content" | "isTruncated" | "fullContentLength"
  >;
}
```

Add imports:

```ts
import { useFullContent } from "@/hooks/useMessages";
import { buildToolDisplayState } from "@/lib/tool-events";
import type { AgentEventMetadata, Message } from "@/types/im";
```

Replace local `unwrapResultContent()` and `deriveLabelStatus()` usage with:

```ts
const fullContentTargetId =
  resultMetadata?.fullContentMessageId ??
  (resultMessage?.isTruncated ? resultMessage.id : undefined);
const shouldFetchFullContent = isExpanded && !!fullContentTargetId;
const { data: fullContentData } = useFullContent(
  fullContentTargetId,
  shouldFetchFullContent,
);
const effectiveResultContent =
  fullContentData?.content ?? resultContent ?? resultMessage?.content ?? "";
const displayState = buildToolDisplayState({
  callMetadata,
  resultMetadata,
  resultContent: effectiveResultContent,
});
const labelStatus = displayState.status;
```

Use these display-state fields:

```ts
const toolName = displayState.toolName;
const paramsSummary = displayState.argsSummary;
const displayLine = paramsSummary ? `${toolName}(${paramsSummary})` : toolName;
const unwrapped = displayState.resultText;
const indicatorChar =
  displayState.indicator === "cross"
    ? "\u2718"
    : displayState.indicator === "check"
      ? "\u2714"
      : "";
```

Render Args from `displayState.argsText`:

```tsx
{
  displayState.argsText && (
    <div>
      <span className="text-xs font-semibold text-muted-foreground">
        {t("tracking.toolCall.argsLabel")}
      </span>
      <pre className="mt-0.5 p-2 rounded-md text-xs leading-relaxed max-h-32 overflow-y-auto whitespace-pre-wrap break-all bg-muted/60 border border-border font-mono text-foreground/85">
        {displayState.argsText}
      </pre>
    </div>
  );
}
```

- [ ] **Step 4: Run ToolCallBlock tests until green**

Run:

```bash
pnpm -C apps/client test src/components/channel/__tests__/ToolCallBlock.test.tsx
```

Expected: all ToolCallBlock tests pass.

- [ ] **Step 5: Commit Task 2**

Run:

```bash
git add apps/client/src/components/channel/ToolCallBlock.tsx apps/client/src/components/channel/__tests__/ToolCallBlock.test.tsx
git commit -m "fix(client): derive tool status from standardized metadata"
```

Expected: commit includes only `ToolCallBlock` and its tests.

---

### Task 3: Running Tool Calls Render As Tool Cards

**Files:**

- Modify: `apps/client/src/components/channel/MessageList.tsx`
- Modify: `apps/client/src/components/channel/TrackingCard.tsx`
- Modify: `apps/client/src/components/channel/__tests__/MessageList.test.tsx`
- Modify: `apps/client/src/components/channel/__tests__/TrackingCard.test.tsx`

- [ ] **Step 1: Add MessageList failing test for standalone running tool_call**

In `apps/client/src/components/channel/__tests__/MessageList.test.tsx`, add:

```tsx
it("renders an unpaired running tool_call as a ToolCallBlock", () => {
  const messages = [
    {
      ...makeToolCall("call-1", "tc-running", "RunScript"),
      metadata: {
        agentEventType: "tool_call",
        status: "running",
        toolCallId: "tc-running",
        toolName: "RunScript",
        toolArgsText: '{"cmd":"pnpm test',
      },
    },
  ];

  renderMessageList({ messages });

  const blocks = screen.getAllByTestId("tool-call-block");
  expect(blocks).toHaveLength(1);
  expect(blocks[0].getAttribute("data-tool-call-id")).toBe("tc-running");
  expect(blocks[0].getAttribute("data-result-tool-call-id")).toBe("");
});
```

If the test file lacks `renderMessageList`, use its existing render helper and pass the `messages` prop exactly like the surrounding direct-channel tests.

- [ ] **Step 2: Add TrackingCard failing test for active running tool_call**

In `apps/client/src/components/channel/__tests__/TrackingCard.test.tsx`, add:

```tsx
it("renders an active streaming tool_call as ToolCallBlock", () => {
  render(
    <TrackingCard
      message={makeTrackingMessage({
        trackingChannelId: "tracking-1",
      })}
    />,
  );

  mockUseTrackingChannel.mockReturnValue({
    isActivated: true,
    latestMessages: [],
    totalMessageCount: 0,
    isLoading: false,
    activeStream: {
      streamId: "stream-tool",
      content: "",
      metadata: {
        agentEventType: "tool_call",
        status: "running",
        toolCallId: "tc-stream",
        toolName: "RunScript",
        toolArgsText: '{"cmd":"pnpm',
      },
    },
  });

  expect(mockToolCallBlock).toHaveBeenCalledWith(
    expect.objectContaining({
      callMetadata: expect.objectContaining({
        toolCallId: "tc-stream",
        toolName: "RunScript",
      }),
      resultMetadata: undefined,
    }),
  );
});
```

Place the `mockUseTrackingChannel.mockReturnValue()` before `render()` if the current mock structure reads hook data during render.

- [ ] **Step 3: Run failing list/card tests**

Run:

```bash
pnpm -C apps/client test src/components/channel/__tests__/MessageList.test.tsx src/components/channel/__tests__/TrackingCard.test.tsx
```

Expected: new running tool-call assertions fail because unpaired calls still render through `TrackingEventItem`.

- [ ] **Step 4: Update MessageList standalone tool_call branch**

In `apps/client/src/components/channel/MessageList.tsx`, after the paired `tool_call + tool_result` branch and before the `tool_result` hiding branch, add:

```tsx
if (agentMeta?.agentEventType === "tool_call" && agentMeta.toolCallId) {
  const prevItem = listDataRef.current[itemIndex - 1];
  const prevIsAgentEvent =
    prevItem?.type === "message" && !!getAgentMeta(prevItem.message);
  const isFirstInGroup = !prevIsAgentEvent;

  return (
    <div
      id={`message-${message.id}`}
      className={cn(
        "ml-2 mr-4 border-l-2 border-border bg-muted/30 rounded-r-md pr-4",
        isFirstInGroup ? "mt-1 pt-1.5" : "",
        "pb-0.5",
      )}
      style={{ paddingLeft: "9px" }}
    >
      <ToolCallBlock callMetadata={agentMeta} resultContent="" />
    </div>
  );
}
```

In the paired branch, pass result message metadata:

```tsx
<ToolCallBlock
  callMetadata={agentMeta}
  resultMetadata={nextMeta}
  resultContent={nextMsg?.content ?? ""}
  resultMessage={nextMsg}
/>
```

- [ ] **Step 5: Update TrackingCard render path**

In `apps/client/src/components/channel/TrackingCard.tsx`, inside `visibleRenderItems.map`, add a branch before generic `TrackingEventItem`:

```tsx
if (ri.item.metadata.agentEventType === "tool_call") {
  return (
    <ToolCallBlock
      key={ri.item.id}
      callMetadata={ri.item.metadata}
      resultContent=""
    />
  );
}
```

- [ ] **Step 6: Run list/card tests until green**

Run:

```bash
pnpm -C apps/client test src/components/channel/__tests__/MessageList.test.tsx src/components/channel/__tests__/TrackingCard.test.tsx
```

Expected: MessageList and TrackingCard tests pass.

- [ ] **Step 7: Commit Task 3**

Run:

```bash
git add apps/client/src/components/channel/MessageList.tsx apps/client/src/components/channel/TrackingCard.tsx apps/client/src/components/channel/__tests__/MessageList.test.tsx apps/client/src/components/channel/__tests__/TrackingCard.test.tsx
git commit -m "feat(client): show running tool calls immediately"
```

Expected: commit includes only running tool-call render changes and tests.

---

### Task 4: Server Tool Result Metadata Normalization

**Files:**

- Create: `apps/server/apps/gateway/src/im/messages/utils/tool-event-metadata.ts`
- Create: `apps/server/apps/gateway/src/im/messages/utils/tool-event-metadata.spec.ts`
- Modify: `apps/server/apps/gateway/src/im/messages/messages.controller.ts`
- Modify: `apps/server/apps/gateway/src/im/streaming/streaming.controller.ts`

- [ ] **Step 1: Write failing server normalization tests**

Create `apps/server/apps/gateway/src/im/messages/utils/tool-event-metadata.spec.ts`:

```ts
import { normalizeToolEventMetadata } from "./tool-event-metadata.js";

describe("normalizeToolEventMetadata", () => {
  it("sets success false when a completed tool_result content has success false", () => {
    const result = normalizeToolEventMetadata(
      {
        agentEventType: "tool_result",
        status: "completed",
        toolCallId: "tc-1",
      },
      '{"success":false,"error":"denied"}',
    );

    expect(result).toMatchObject({
      agentEventType: "tool_result",
      status: "failed",
      success: false,
      errorMessage: "denied",
    });
  });

  it("sets success false for failed status without changing toolCallId", () => {
    const result = normalizeToolEventMetadata(
      {
        agentEventType: "tool_result",
        status: "failed",
        toolCallId: "tc-2",
      },
      "permission denied",
    );

    expect(result).toMatchObject({
      status: "failed",
      success: false,
      toolCallId: "tc-2",
      errorMessage: "permission denied",
    });
  });

  it("sets success true for completed tool_result with no failure evidence", () => {
    const result = normalizeToolEventMetadata(
      {
        agentEventType: "tool_result",
        status: "completed",
        toolCallId: "tc-3",
      },
      '{"success":true}',
    );

    expect(result).toMatchObject({
      status: "completed",
      success: true,
      toolCallId: "tc-3",
    });
  });

  it("returns non-tool metadata unchanged", () => {
    const metadata = { agentEventType: "thinking", status: "completed" };
    expect(normalizeToolEventMetadata(metadata, "x")).toBe(metadata);
  });
});
```

- [ ] **Step 2: Run failing server test**

Run:

```bash
pnpm -C apps/server test apps/gateway/src/im/messages/utils/tool-event-metadata.spec.ts
```

Expected: fail because the helper file does not exist.

- [ ] **Step 3: Implement server helper**

Create `apps/server/apps/gateway/src/im/messages/utils/tool-event-metadata.ts`:

```ts
type Metadata = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function unwrapTextContent(raw: string): string {
  const parsed = parseJson(raw);
  if (isRecord(parsed) && Array.isArray(parsed.content)) {
    const text = parsed.content
      .filter(
        (block): block is { type: string; text: string } =>
          isRecord(block) &&
          block.type === "text" &&
          typeof block.text === "string",
      )
      .map((block) => block.text)
      .join("\n");
    if (text) return text;
  }
  return raw;
}

function getFailureMessage(content: string): string | undefined {
  const unwrapped = unwrapTextContent(content);
  const parsed = parseJson(unwrapped);
  if (isRecord(parsed)) {
    if (parsed.success === false) {
      if (typeof parsed.errorMessage === "string") return parsed.errorMessage;
      if (typeof parsed.error === "string") return parsed.error;
      return "Tool returned success=false";
    }
    if (typeof parsed.errorMessage === "string") return parsed.errorMessage;
    if (typeof parsed.error === "string") return parsed.error;
  }
  return unwrapped.trim() || undefined;
}

export function normalizeToolEventMetadata(
  metadata: Metadata | undefined,
  content: string,
): Metadata | undefined {
  if (!metadata || metadata.agentEventType !== "tool_result") {
    return metadata;
  }

  const failedStatus =
    metadata.status === "failed" ||
    metadata.status === "cancelled" ||
    metadata.status === "timeout";
  const failureMessage =
    metadata.success === false || failedStatus
      ? typeof metadata.errorMessage === "string"
        ? metadata.errorMessage
        : getFailureMessage(content)
      : getFailureMessage(content);
  const failedByPayload = failureMessage && metadata.success !== true;
  const success = failedStatus || failedByPayload ? false : true;

  return {
    ...metadata,
    status: success ? (metadata.status ?? "completed") : "failed",
    success,
    completedAt:
      typeof metadata.completedAt === "string"
        ? metadata.completedAt
        : new Date().toISOString(),
    ...(!success && failureMessage ? { errorMessage: failureMessage } : {}),
  };
}
```

- [ ] **Step 4: Run server helper test until green**

Run:

```bash
pnpm -C apps/server test apps/gateway/src/im/messages/utils/tool-event-metadata.spec.ts
```

Expected: helper tests pass.

- [ ] **Step 5: Normalize metadata in HTTP message creation**

In `apps/server/apps/gateway/src/im/messages/messages.controller.ts`, import:

```ts
import { normalizeToolEventMetadata } from "./utils/tool-event-metadata.js";
```

Replace metadata creation in `createChannelMessage()` with:

```ts
const rawMetadata = dto.clientContext
  ? { ...(dto.metadata ?? {}), clientContext: dto.clientContext }
  : dto.metadata;
const metadata = normalizeToolEventMetadata(rawMetadata, normalizedContent);
```

- [ ] **Step 6: Normalize metadata in streaming finalization**

In `apps/server/apps/gateway/src/im/streaming/streaming.controller.ts`, import:

```ts
import { normalizeToolEventMetadata } from "../messages/utils/tool-event-metadata.js";
```

Before `createMessage()` in `endStreaming()`, replace the metadata assignment with:

```ts
const metadata = normalizeToolEventMetadata(
  Object.keys(metadata).length > 0 ? metadata : session.metadata,
  dto.content,
);
```

If this collides with the existing `const metadata` declaration, rename the mutable object to `baseMetadata` first:

```ts
const baseMetadata: Record<string, unknown> = {};
if (dto.thinking) {
  baseMetadata.thinking = dto.thinking;
}
const metadata = normalizeToolEventMetadata(
  Object.keys(baseMetadata).length > 0 ? baseMetadata : session.metadata,
  dto.content,
);
```

- [ ] **Step 7: Run focused server tests**

Run:

```bash
pnpm -C apps/server test apps/gateway/src/im/messages/utils/tool-event-metadata.spec.ts apps/gateway/src/im/streaming/streaming.controller.spec.ts
```

Expected: tests pass.

- [ ] **Step 8: Commit Task 4**

Run:

```bash
git add apps/server/apps/gateway/src/im/messages/utils/tool-event-metadata.ts apps/server/apps/gateway/src/im/messages/utils/tool-event-metadata.spec.ts apps/server/apps/gateway/src/im/messages/messages.controller.ts apps/server/apps/gateway/src/im/streaming/streaming.controller.ts
git commit -m "feat(server): normalize tool result metadata"
```

Expected: commit excludes existing unrelated `apps/server/apps/gateway/src/routines/*` changes.

---

### Task 5: Verification Pass

**Files:**

- Read: `docs/superpowers/specs/2026-05-01-tool-events-design.md`
- Read: `docs/superpowers/plans/2026-05-01-tool-events-standard.md`

- [ ] **Step 1: Run frontend focused tests**

Run:

```bash
pnpm -C apps/client test src/lib/__tests__/tool-events.test.ts src/components/channel/__tests__/ToolCallBlock.test.tsx src/components/channel/__tests__/MessageList.test.tsx src/components/channel/__tests__/TrackingCard.test.tsx
```

Expected: all listed frontend tests pass.

- [ ] **Step 2: Run server focused tests**

Run:

```bash
pnpm -C apps/server test apps/gateway/src/im/messages/utils/tool-event-metadata.spec.ts apps/gateway/src/im/streaming/streaming.controller.spec.ts
```

Expected: all listed server tests pass.

- [ ] **Step 3: Run typecheck and lint**

Run:

```bash
pnpm -C apps/client typecheck
pnpm -C apps/client lint:ci
pnpm -C apps/server lint:ci
```

Expected: commands exit 0. The client route generator may print existing route-test warnings; those warnings are acceptable only if `pnpm -C apps/client typecheck` exits 0.

- [ ] **Step 4: Confirm unrelated files are still unstaged**

Run:

```bash
git status --short
```

Expected: only the pre-existing `apps/server/apps/gateway/src/routines/*` files remain modified after all task commits, unless the user explicitly asks to include them.

- [ ] **Step 5: Final commit if verification changed generated files**

If lint or formatting changed files after Task 4, run:

```bash
git add apps/client/src apps/server/apps/gateway/src/im/messages apps/server/apps/gateway/src/im/streaming
git diff --cached --name-only
git commit -m "chore: finalize tool event standard"
```

Expected: this commit contains only formatting or generated changes caused by verification.

---

## Self-Review

Spec coverage:

- Deterministic failure display is covered by Tasks 1, 2, and 4.
- Running tool display is covered by Task 3.
- Full expanded result content is covered by Task 2.
- Server-side standard metadata is covered by Task 4.
- Historical compatibility is covered by Task 1 content parsing and Task 2 rendering.

Type consistency:

- The frontend helper uses `StatusType` from `apps/client/src/config/toolLabels.ts`.
- The display helper returns `status`, and `ToolCallBlock` continues feeding that status into `getLabelKey()`.
- The first implementation uses `toolPhase` on `tool_call` metadata instead of adding a new `tool_delta` union member.

Scope:

- This plan does not migrate old rows.
- This plan does not redesign the full tracking channel model.
- This plan keeps unrelated routines files out of the work.

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

  it("detects tool-not-found text errors as failure even when old metadata says success", () => {
    const state = buildToolDisplayState({
      callMetadata: callMeta({ toolName: "invoke_tool" }),
      resultMetadata: resultMeta({ success: true }),
      resultContent:
        "tool not found: completeRoutine. Use search_tools to find available tools.",
    });

    expect(state.status).toBe("error");
    expect(state.isError).toBe(true);
    expect(state.indicator).toBe("cross");
    expect(state.errorMessage).toBe(
      "tool not found: completeRoutine. Use search_tools to find available tools.",
    );
  });

  it("renders a missing result as running", () => {
    const state = buildToolDisplayState({
      callMetadata: callMeta({
        toolArgs: undefined,
        toolArgsText: '{"message":"hel',
      }),
    });

    expect(state.status).toBe("loading");
    expect(state.isRunning).toBe(true);
    expect(state.argsText).toBe('{"message":"hel');
  });

  it("uses structured args for expanded text when partial args text also exists", () => {
    const state = buildToolDisplayState({
      callMetadata: callMeta({ toolArgsText: '{"message":"hel' }),
    });

    expect(state.argsText).toBe(JSON.stringify({ message: "hello" }, null, 2));
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

  it("keeps explicitly successful results as success when content has an error field", () => {
    const state = buildToolDisplayState({
      callMetadata: callMeta(),
      resultMetadata: resultMeta({ success: true }),
      resultContent: '{"error":"domain field, not failure"}',
    });

    expect(state.status).toBe("success");
    expect(state.isSuccess).toBe(true);
  });
});

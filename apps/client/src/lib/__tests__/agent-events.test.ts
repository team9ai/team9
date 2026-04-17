import { describe, it, expect } from "vitest";
import {
  getAgentMeta,
  getEffectiveTimeMs,
  pairToolEvents,
  sortByEffectiveTime,
} from "../agent-events";
import type { Message } from "@/types/im";

/** Minimal message factory for tests */
function makeMsg(
  id: string,
  metadata?: Record<string, unknown>,
  createdAt?: string,
): Message {
  return {
    id,
    channelId: "ch-1",
    senderId: "bot-1",
    content: id,
    type: "text",
    isPinned: false,
    isEdited: false,
    isDeleted: false,
    createdAt: createdAt ?? new Date().toISOString(),
    updatedAt: createdAt ?? new Date().toISOString(),
    metadata,
  };
}

function makeToolCall(id: string, toolCallId: string, toolName: string) {
  return makeMsg(id, {
    agentEventType: "tool_call",
    status: "completed",
    toolName,
    toolCallId,
  });
}

function makeToolResult(id: string, toolCallId: string, toolName?: string) {
  return makeMsg(id, {
    agentEventType: "tool_result",
    status: "completed",
    success: true,
    toolCallId,
    toolName,
  });
}

// ---------------------------------------------------------------------------
// getAgentMeta
// ---------------------------------------------------------------------------

describe("getAgentMeta", () => {
  it("returns metadata when agentEventType is present", () => {
    const msg = makeMsg("1", {
      agentEventType: "tool_call",
      status: "completed",
    });
    const meta = getAgentMeta(msg);
    expect(meta).toBeDefined();
    expect(meta!.agentEventType).toBe("tool_call");
  });

  it("returns undefined when metadata is absent", () => {
    const msg = makeMsg("1");
    expect(getAgentMeta(msg)).toBeUndefined();
  });

  it("returns undefined when metadata has no agentEventType", () => {
    const msg = makeMsg("1", { someOther: "data" });
    expect(getAgentMeta(msg)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// pairToolEvents
// ---------------------------------------------------------------------------

describe("pairToolEvents", () => {
  it("returns empty array for empty input", () => {
    expect(pairToolEvents([])).toEqual([]);
  });

  it("passes through messages with no agent metadata", () => {
    const msgs = [makeMsg("a"), makeMsg("b"), makeMsg("c")];
    const result = pairToolEvents(msgs);
    expect(result).toBe(msgs); // same reference (early return)
  });

  it("passes through unpaired tool_call (no matching result)", () => {
    const msgs = [makeToolCall("tc-1", "call-1", "Search"), makeMsg("text-1")];
    const result = pairToolEvents(msgs);
    expect(result).toBe(msgs); // no pairs found, same reference
  });

  it("passes through unpaired tool_result (no matching call)", () => {
    const msgs = [makeToolResult("tr-1", "call-99"), makeMsg("text-1")];
    const result = pairToolEvents(msgs);
    expect(result).toBe(msgs);
  });

  it("pairs a single tool_call with its tool_result", () => {
    const call = makeToolCall("tc-1", "call-1", "Search");
    const result = makeToolResult("tr-1", "call-1");
    const msgs = [call, makeMsg("text"), result];

    const paired = pairToolEvents(msgs);
    expect(paired.map((m) => m.id)).toEqual(["tc-1", "tr-1", "text"]);
  });

  it("pairs multiple parallel tool calls with interleaved results", () => {
    // Simulates: call_A, call_B, result_A, result_B
    const callA = makeToolCall("tc-A", "call-A", "SendToChannel");
    const callB = makeToolCall("tc-B", "call-B", "Terminate");
    const resultA = makeToolResult("tr-A", "call-A");
    const resultB = makeToolResult("tr-B", "call-B");
    const msgs = [callA, callB, resultA, resultB];

    const paired = pairToolEvents(msgs);
    expect(paired.map((m) => m.id)).toEqual([
      "tc-A",
      "tr-A", // call A + result A
      "tc-B",
      "tr-B", // call B + result B
    ]);
  });

  it("preserves non-agent messages between paired events", () => {
    const start = makeMsg("start", {
      agentEventType: "agent_start",
      status: "completed",
    });
    const callA = makeToolCall("tc-A", "call-A", "Search");
    const callB = makeToolCall("tc-B", "call-B", "Read");
    const resultA = makeToolResult("tr-A", "call-A");
    const resultB = makeToolResult("tr-B", "call-B");
    const end = makeMsg("end", {
      agentEventType: "agent_end",
      status: "completed",
    });

    const msgs = [start, callA, callB, resultA, resultB, end];
    const paired = pairToolEvents(msgs);
    expect(paired.map((m) => m.id)).toEqual([
      "start",
      "tc-A",
      "tr-A",
      "tc-B",
      "tr-B",
      "end",
    ]);
  });

  it("handles tool_call without toolCallId (no pairing)", () => {
    const call = makeMsg("tc-1", {
      agentEventType: "tool_call",
      status: "completed",
      toolName: "OldTool",
      // no toolCallId
    });
    const result = makeMsg("tr-1", {
      agentEventType: "tool_result",
      status: "completed",
      // no toolCallId
    });
    const msgs = [call, result];
    const paired = pairToolEvents(msgs);
    expect(paired).toBe(msgs); // no pairs, same reference
  });

  it("preserves message count (no duplicates or drops)", () => {
    const callA = makeToolCall("tc-A", "call-A", "A");
    const callB = makeToolCall("tc-B", "call-B", "B");
    const resultA = makeToolResult("tr-A", "call-A");
    const resultB = makeToolResult("tr-B", "call-B");
    const text = makeMsg("text-1");
    const msgs = [text, callA, callB, resultA, resultB];

    const paired = pairToolEvents(msgs);
    expect(paired).toHaveLength(msgs.length);
    // All original IDs are present
    const ids = new Set(paired.map((m) => m.id));
    for (const msg of msgs) {
      expect(ids.has(msg.id)).toBe(true);
    }
  });

  it("handles duplicate toolCallId across results (last result wins pairing)", () => {
    const call = makeToolCall("tc-1", "call-1", "Search");
    const result1 = makeToolResult("tr-1", "call-1");
    const result2 = makeToolResult("tr-2", "call-1");
    const msgs = [call, result1, result2];

    const paired = pairToolEvents(msgs);
    // result2 overwrites result1 in Map, so result2 is paired
    // result1 is NOT in pairedResultIds, so it stays in place
    expect(paired.map((m) => m.id)).toEqual(["tc-1", "tr-2", "tr-1"]);
  });
});

// ---------------------------------------------------------------------------
// getEffectiveTimeMs
// ---------------------------------------------------------------------------

describe("getEffectiveTimeMs", () => {
  it("falls back to createdAt when no agent metadata", () => {
    const msg = makeMsg("m-1", undefined, "2026-04-17T10:00:00.000Z");
    expect(getEffectiveTimeMs(msg)).toBe(
      new Date("2026-04-17T10:00:00.000Z").getTime(),
    );
  });

  it("falls back to createdAt when agent metadata has no startedAt", () => {
    const msg = makeMsg(
      "m-1",
      { agentEventType: "tool_call", status: "completed" },
      "2026-04-17T10:00:05.000Z",
    );
    expect(getEffectiveTimeMs(msg)).toBe(
      new Date("2026-04-17T10:00:05.000Z").getTime(),
    );
  });

  it("uses metadata.startedAt when present", () => {
    const msg = makeMsg(
      "m-1",
      {
        agentEventType: "thinking",
        status: "completed",
        startedAt: "2026-04-17T10:00:00.000Z",
      },
      "2026-04-17T10:00:05.000Z",
    );
    // 5s earlier than createdAt — matches when thinking actually began.
    expect(getEffectiveTimeMs(msg)).toBe(
      new Date("2026-04-17T10:00:00.000Z").getTime(),
    );
  });

  it("falls back to createdAt when startedAt is unparseable", () => {
    const msg = makeMsg(
      "m-1",
      {
        agentEventType: "thinking",
        status: "completed",
        startedAt: "not-a-date",
      },
      "2026-04-17T10:00:05.000Z",
    );
    expect(getEffectiveTimeMs(msg)).toBe(
      new Date("2026-04-17T10:00:05.000Z").getTime(),
    );
  });
});

// ---------------------------------------------------------------------------
// sortByEffectiveTime
// ---------------------------------------------------------------------------

describe("sortByEffectiveTime", () => {
  it("returns empty array for empty input", () => {
    expect(sortByEffectiveTime([])).toEqual([]);
  });

  it("keeps chronological createdAt order for non-agent messages", () => {
    const m1 = makeMsg("m-1", undefined, "2026-04-17T10:00:00.000Z");
    const m2 = makeMsg("m-2", undefined, "2026-04-17T10:00:01.000Z");
    const m3 = makeMsg("m-3", undefined, "2026-04-17T10:00:02.000Z");
    const sorted = sortByEffectiveTime([m1, m2, m3]);
    expect(sorted.map((m) => m.id)).toEqual(["m-1", "m-2", "m-3"]);
  });

  it("moves a thinking event before its reply when startedAt is earlier", () => {
    // Real-world bug: thinking persists at end-of-thinking (createdAt =
    // t+5s), but startedAt = t+0s — that's before the reply started
    // streaming at t+2s. Sorting by effective time puts thinking first.
    const agentStart = makeMsg(
      "start",
      {
        agentEventType: "agent_start",
        status: "completed",
        startedAt: "2026-04-17T10:00:00.000Z",
      },
      "2026-04-17T10:00:00.000Z",
    );
    const reply = makeMsg("reply", undefined, "2026-04-17T10:00:02.000Z");
    const thinking = makeMsg(
      "thinking",
      {
        agentEventType: "thinking",
        status: "completed",
        startedAt: "2026-04-17T10:00:01.000Z",
      },
      "2026-04-17T10:00:05.000Z",
    );

    // Server order after DESC→ASC reverse: start, reply, thinking.
    const sorted = sortByEffectiveTime([agentStart, reply, thinking]);
    expect(sorted.map((m) => m.id)).toEqual(["start", "thinking", "reply"]);
  });

  it("is stable: preserves original order for equal effective times", () => {
    const shared = "2026-04-17T10:00:00.000Z";
    const a = makeMsg("a", undefined, shared);
    const b = makeMsg("b", undefined, shared);
    const c = makeMsg("c", undefined, shared);
    expect(sortByEffectiveTime([a, b, c]).map((m) => m.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(sortByEffectiveTime([c, a, b]).map((m) => m.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("does not move agent_end that actually happened after the reply", () => {
    // agent_end carries startedAt = end-of-round, which is after the
    // reply. Sorting must NOT accidentally pull it earlier.
    const reply = makeMsg("reply", undefined, "2026-04-17T10:00:02.000Z");
    const agentEnd = makeMsg(
      "end",
      {
        agentEventType: "agent_end",
        status: "completed",
        startedAt: "2026-04-17T10:00:06.000Z",
      },
      "2026-04-17T10:00:06.000Z",
    );
    const sorted = sortByEffectiveTime([reply, agentEnd]);
    expect(sorted.map((m) => m.id)).toEqual(["reply", "end"]);
  });

  it("clamps thinking.startedAt to agent_start.createdAt so 'Started' stays first", () => {
    // Real-world scenario: the LLM call begins a few ms *before* the
    // tracking observer persists agent_start, so thinking.startedAt
    // (derived from llm_call timestamps) lands microscopically earlier
    // than agent_start.createdAt. Without the clamp, effective-time
    // sort would put "Thought for Xs" above "Started", which reads
    // wrong — lifecycle markers should bookend the round.
    const agentStart = makeMsg(
      "start",
      { agentEventType: "agent_start", status: "completed" },
      "2026-04-17T10:00:00.050Z", // agent_start persisted at +50ms
    );
    const thinking = makeMsg(
      "thinking",
      {
        agentEventType: "thinking",
        status: "completed",
        startedAt: "2026-04-17T10:00:00.000Z", // LLM started at +0ms (earlier!)
      },
      "2026-04-17T10:00:03.000Z",
    );
    const sorted = sortByEffectiveTime([agentStart, thinking]);
    expect(sorted.map((m) => m.id)).toEqual(["start", "thinking"]);
  });

  it("still slides thinking back across a text reply within the round", () => {
    // The clamp in the previous test must not over-correct — once
    // agent_start has been seen, thinking is still free to move back
    // through interleaved tool_calls and text replies to its true
    // startedAt position, so long as it stays after agent_start.
    const agentStart = makeMsg(
      "start",
      {
        agentEventType: "agent_start",
        status: "completed",
        startedAt: "2026-04-17T10:00:00.000Z",
      },
      "2026-04-17T10:00:00.000Z",
    );
    const reply = makeMsg("reply", undefined, "2026-04-17T10:00:02.000Z");
    const thinking = makeMsg(
      "thinking",
      {
        agentEventType: "thinking",
        status: "completed",
        startedAt: "2026-04-17T10:00:01.000Z", // after start, before reply
      },
      "2026-04-17T10:00:05.000Z",
    );
    const sorted = sortByEffectiveTime([agentStart, reply, thinking]);
    expect(sorted.map((m) => m.id)).toEqual(["start", "thinking", "reply"]);
  });
});

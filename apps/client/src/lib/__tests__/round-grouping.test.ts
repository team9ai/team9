/**
 * Unit tests for `groupMessagesByRound`.
 *
 * Covers:
 *   - Empty / single-item inputs
 *   - All layouts of rounds vs. regular messages
 *   - `isLatest`, `roundId`, `stepCount` correctness
 *   - Mixed agent event types are all treated as rounds
 *   - Bad metadata shapes (null, string, missing field, unknown type)
 *     are NOT treated as agent events
 *   - Input array is not mutated
 */

import { describe, it, expect } from "vitest";
import { groupMessagesByRound, type RoundGroupItem } from "../round-grouping";
import type { AgentEventMetadata, Message, MessageType } from "@/types/im";

type MessageOverrides = Partial<Message> & { id: string };

function makeMessage(overrides: MessageOverrides): Message {
  return {
    channelId: "channel-1",
    senderId: "user-1",
    content: "hello",
    type: "text" as MessageType,
    isPinned: false,
    isEdited: false,
    isDeleted: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeAgentEventMessage(
  id: string,
  agentEventType: AgentEventMetadata["agentEventType"] = "thinking",
  overrides: Partial<Message> = {},
): Message {
  return makeMessage({
    id,
    senderId: "bot-1",
    content: `${agentEventType} event`,
    metadata: {
      agentEventType,
      status: "running",
    },
    ...overrides,
  });
}

function makeRegularMessage(
  id: string,
  overrides: Partial<Message> = {},
): Message {
  return makeMessage({ id, ...overrides });
}

function expectRound(
  item: RoundGroupItem,
): Extract<RoundGroupItem, { type: "round" }> {
  if (item.type !== "round") {
    throw new Error(`Expected round item, got ${item.type}`);
  }
  return item;
}

function expectMessage(
  item: RoundGroupItem,
): Extract<RoundGroupItem, { type: "message" }> {
  if (item.type !== "message") {
    throw new Error(`Expected message item, got ${item.type}`);
  }
  return item;
}

describe("groupMessagesByRound", () => {
  describe("empty and trivial inputs", () => {
    it("returns empty array for empty input", () => {
      expect(groupMessagesByRound([])).toEqual([]);
    });

    it("returns a single message item for one regular message", () => {
      const m = makeRegularMessage("m1");
      const result = groupMessagesByRound([m]);
      expect(result).toHaveLength(1);
      const message = expectMessage(result[0]);
      expect(message.message).toBe(m);
    });

    it("returns a single latest round for one agent event", () => {
      const e = makeAgentEventMessage("e1", "thinking");
      const result = groupMessagesByRound([e]);
      expect(result).toHaveLength(1);
      const round = expectRound(result[0]);
      expect(round.roundId).toBe("e1");
      expect(round.messages).toEqual([e]);
      expect(round.stepCount).toBe(1);
      expect(round.isLatest).toBe(true);
    });
  });

  describe("contiguous agent events", () => {
    it("groups multiple consecutive agent events into one latest round", () => {
      const events = [
        makeAgentEventMessage("e1", "thinking"),
        makeAgentEventMessage("e2", "tool_call"),
        makeAgentEventMessage("e3", "tool_result"),
        makeAgentEventMessage("e4", "agent_end"),
      ];
      const result = groupMessagesByRound(events);
      expect(result).toHaveLength(1);
      const round = expectRound(result[0]);
      expect(round.roundId).toBe("e1");
      expect(round.messages).toEqual(events);
      expect(round.stepCount).toBe(4);
      expect(round.isLatest).toBe(true);
    });

    it("recognises every known agent event type as part of a round", () => {
      const types: AgentEventMetadata["agentEventType"][] = [
        "thinking",
        "writing",
        "tool_call",
        "tool_result",
        "agent_start",
        "agent_end",
        "error",
        "turn_separator",
        "a2ui_surface_update",
        "a2ui_response",
      ];
      const events = types.map((t, i) => makeAgentEventMessage(`e${i}`, t));
      const result = groupMessagesByRound(events);
      expect(result).toHaveLength(1);
      const round = expectRound(result[0]);
      // stepCount counts visible rows: turn_separator renders as null so it
      // never contributes to the displayed step count. The tool_call and
      // tool_result here lack a matching toolCallId so they are unpaired and
      // still render as their own rows.
      expect(round.stepCount).toBe(types.length - 1);
      expect(round.messages).toEqual(events);
      expect(round.isLatest).toBe(true);
    });
  });

  describe("visible stepCount rules", () => {
    it("counts a paired tool_call + tool_result as a single visible step", () => {
      const call = makeAgentEventMessage("call", "tool_call", {
        metadata: {
          agentEventType: "tool_call",
          status: "completed",
          toolCallId: "c-1",
          toolName: "search",
        },
      });
      const result = makeAgentEventMessage("result", "tool_result", {
        metadata: {
          agentEventType: "tool_result",
          status: "completed",
          toolCallId: "c-1",
          toolName: "search",
        },
      });
      const round = expectRound(groupMessagesByRound([call, result])[0]);
      expect(round.messages).toEqual([call, result]);
      // 2 messages → 1 displayed ToolCallBlock card.
      expect(round.stepCount).toBe(1);
    });

    it("counts each paired tool_call/tool_result pair independently", () => {
      const events = [
        makeAgentEventMessage("think", "thinking"),
        makeAgentEventMessage("c1", "tool_call", {
          metadata: {
            agentEventType: "tool_call",
            status: "completed",
            toolCallId: "c-1",
            toolName: "a",
          },
        }),
        makeAgentEventMessage("r1", "tool_result", {
          metadata: {
            agentEventType: "tool_result",
            status: "completed",
            toolCallId: "c-1",
            toolName: "a",
          },
        }),
        makeAgentEventMessage("c2", "tool_call", {
          metadata: {
            agentEventType: "tool_call",
            status: "completed",
            toolCallId: "c-2",
            toolName: "b",
          },
        }),
        makeAgentEventMessage("r2", "tool_result", {
          metadata: {
            agentEventType: "tool_result",
            status: "completed",
            toolCallId: "c-2",
            toolName: "b",
          },
        }),
      ];
      const round = expectRound(groupMessagesByRound(events)[0]);
      // thinking (1) + 2 paired tool call cards (2) = 3 visible rows.
      expect(round.stepCount).toBe(3);
    });

    it("counts an unpaired tool_result as a visible step", () => {
      const orphan = makeAgentEventMessage("orphan", "tool_result", {
        metadata: {
          agentEventType: "tool_result",
          status: "completed",
          toolCallId: "never-paired",
          toolName: "x",
        },
      });
      const round = expectRound(groupMessagesByRound([orphan])[0]);
      expect(round.stepCount).toBe(1);
    });

    it("excludes turn_separator from the visible step count", () => {
      const events = [
        makeAgentEventMessage("start", "agent_start"),
        makeAgentEventMessage("sep", "turn_separator"),
        makeAgentEventMessage("end", "agent_end"),
      ];
      const round = expectRound(groupMessagesByRound(events)[0]);
      // agent_start + agent_end = 2 visible; turn_separator contributes 0.
      expect(round.stepCount).toBe(2);
    });
  });

  describe("mixed layouts", () => {
    it("agent events followed by a reply: round (not latest) + message", () => {
      const e1 = makeAgentEventMessage("e1", "thinking");
      const e2 = makeAgentEventMessage("e2", "tool_call");
      const reply = makeRegularMessage("r1", {
        content: "here is the answer",
      });
      const result = groupMessagesByRound([e1, e2, reply]);

      expect(result).toHaveLength(2);
      const round = expectRound(result[0]);
      expect(round.roundId).toBe("e1");
      expect(round.messages).toEqual([e1, e2]);
      expect(round.stepCount).toBe(2);
      expect(round.isLatest).toBe(false);

      const msg = expectMessage(result[1]);
      expect(msg.message).toBe(reply);
    });

    it("reply followed by agent events: message + latest round", () => {
      const user = makeRegularMessage("u1", { content: "please do it" });
      const e1 = makeAgentEventMessage("e1", "thinking");
      const e2 = makeAgentEventMessage("e2", "tool_call");
      const result = groupMessagesByRound([user, e1, e2]);

      expect(result).toHaveLength(2);
      expect(expectMessage(result[0]).message).toBe(user);
      const round = expectRound(result[1]);
      expect(round.roundId).toBe("e1");
      expect(round.messages).toEqual([e1, e2]);
      expect(round.stepCount).toBe(2);
      expect(round.isLatest).toBe(true);
    });

    it("events + reply + events yields a non-latest round, message, latest round", () => {
      const e1 = makeAgentEventMessage("e1", "thinking");
      const e2 = makeAgentEventMessage("e2", "tool_call");
      const reply = makeRegularMessage("r1", { content: "part 1 done" });
      const e3 = makeAgentEventMessage("e3", "agent_start");
      const e4 = makeAgentEventMessage("e4", "tool_result");

      const result = groupMessagesByRound([e1, e2, reply, e3, e4]);

      expect(result).toHaveLength(3);
      const firstRound = expectRound(result[0]);
      expect(firstRound.roundId).toBe("e1");
      expect(firstRound.messages).toEqual([e1, e2]);
      expect(firstRound.isLatest).toBe(false);
      expect(firstRound.stepCount).toBe(2);

      expect(expectMessage(result[1]).message).toBe(reply);

      const lastRound = expectRound(result[2]);
      expect(lastRound.roundId).toBe("e3");
      expect(lastRound.messages).toEqual([e3, e4]);
      expect(lastRound.isLatest).toBe(true);
      expect(lastRound.stepCount).toBe(2);
    });

    it("events + reply + events + reply has no latest round", () => {
      const e1 = makeAgentEventMessage("e1", "thinking");
      const r1 = makeRegularMessage("r1");
      const e2 = makeAgentEventMessage("e2", "tool_call");
      const r2 = makeRegularMessage("r2");

      const result = groupMessagesByRound([e1, r1, e2, r2]);

      expect(result).toHaveLength(4);
      expect(expectRound(result[0]).isLatest).toBe(false);
      expect(expectRound(result[0]).roundId).toBe("e1");
      expect(expectMessage(result[1]).message).toBe(r1);
      expect(expectRound(result[2]).isLatest).toBe(false);
      expect(expectRound(result[2]).roundId).toBe("e2");
      expect(expectMessage(result[3]).message).toBe(r2);
    });

    it("multiple consecutive regular messages stay as separate items", () => {
      const r1 = makeRegularMessage("r1");
      const r2 = makeRegularMessage("r2");
      const r3 = makeRegularMessage("r3");
      const result = groupMessagesByRound([r1, r2, r3]);
      expect(result).toHaveLength(3);
      expect(expectMessage(result[0]).message).toBe(r1);
      expect(expectMessage(result[1]).message).toBe(r2);
      expect(expectMessage(result[2]).message).toBe(r3);
    });
  });

  describe("non agent-event detection (bad cases)", () => {
    it("treats messages without metadata as regular messages", () => {
      const m = makeRegularMessage("m1", { metadata: undefined });
      const result = groupMessagesByRound([m]);
      expect(result).toHaveLength(1);
      expect(expectMessage(result[0]).message).toBe(m);
    });

    it("treats null metadata as regular messages", () => {
      // Force `metadata: null` even though the type disallows it — we want
      // to make sure the guard does not throw on the common "{metadata:null}"
      // shape that can sneak in from JSON payloads.
      const m = makeRegularMessage("m1", {
        metadata: null as unknown as Record<string, unknown>,
      });
      const result = groupMessagesByRound([m]);
      expect(result).toHaveLength(1);
      expect(expectMessage(result[0]).message).toBe(m);
    });

    it("treats string metadata as regular messages", () => {
      const m = makeRegularMessage("m1", {
        metadata: "not-an-object" as unknown as Record<string, unknown>,
      });
      const result = groupMessagesByRound([m]);
      expect(result).toHaveLength(1);
      expect(expectMessage(result[0]).message).toBe(m);
    });

    it("treats metadata without agentEventType as regular message", () => {
      const m = makeRegularMessage("m1", { metadata: { foo: "bar" } });
      const result = groupMessagesByRound([m]);
      expect(result).toHaveLength(1);
      expect(expectMessage(result[0]).message).toBe(m);
    });

    it("treats unknown agentEventType string as regular message", () => {
      const m = makeRegularMessage("m1", {
        metadata: { agentEventType: "not-a-real-event", status: "running" },
      });
      const result = groupMessagesByRound([m]);
      expect(result).toHaveLength(1);
      expect(expectMessage(result[0]).message).toBe(m);
    });

    it("treats non-string agentEventType as regular message", () => {
      const m = makeRegularMessage("m1", {
        metadata: {
          agentEventType: 42 as unknown as string,
          status: "running",
        },
      });
      const result = groupMessagesByRound([m]);
      expect(result).toHaveLength(1);
      expect(expectMessage(result[0]).message).toBe(m);
    });

    it("a malformed agent-event message between two rounds breaks them apart", () => {
      const e1 = makeAgentEventMessage("e1", "thinking");
      const bogus = makeRegularMessage("m1", {
        metadata: { agentEventType: "bogus" },
      });
      const e2 = makeAgentEventMessage("e2", "tool_call");
      const result = groupMessagesByRound([e1, bogus, e2]);
      expect(result).toHaveLength(3);
      expect(expectRound(result[0]).roundId).toBe("e1");
      expect(expectRound(result[0]).isLatest).toBe(false);
      expect(expectMessage(result[1]).message).toBe(bogus);
      expect(expectRound(result[2]).roundId).toBe("e2");
      expect(expectRound(result[2]).isLatest).toBe(true);
    });
  });

  describe("purity", () => {
    it("does not mutate the input array", () => {
      const input: Message[] = [
        makeAgentEventMessage("e1", "thinking"),
        makeRegularMessage("r1"),
        makeAgentEventMessage("e2", "tool_call"),
      ];
      const snapshot = [...input];
      groupMessagesByRound(input);
      expect(input).toEqual(snapshot);
      expect(input).toHaveLength(3);
    });

    it("returns equivalent output for repeated calls with the same input", () => {
      const input: Message[] = [
        makeAgentEventMessage("e1", "thinking"),
        makeAgentEventMessage("e2", "tool_call"),
        makeRegularMessage("r1"),
        makeAgentEventMessage("e3", "tool_result"),
      ];
      const a = groupMessagesByRound(input);
      const b = groupMessagesByRound(input);
      expect(a).toEqual(b);
    });
  });
});

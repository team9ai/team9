/**
 * Unit tests for the pure round-fold helpers used by MessageList.
 *
 * These helpers decide, for a chronological message array, which non-latest
 * agent-event rounds should be rendered as collapsed summaries in a DM channel.
 * They are deliberately UI-agnostic so we can exhaustively cover the decision
 * logic without standing up a DOM or mocking Virtuoso.
 */

import { describe, it, expect } from "vitest";
import {
  computeRoundFoldMaps,
  decideRoundRender,
  toggleExpandedRound,
} from "../message-list-fold";
import type { Message, AgentEventMetadata, MessageType } from "@/types/im";

function makeMessage(id: string, overrides: Partial<Message> = {}): Message {
  return {
    id,
    channelId: "ch-1",
    senderId: "user-1",
    content: `Message ${id}`,
    type: "text" as MessageType,
    isPinned: false,
    isEdited: false,
    isDeleted: false,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeAgentEvent(
  id: string,
  agentEventType: AgentEventMetadata["agentEventType"] = "thinking",
): Message {
  return makeMessage(id, {
    senderId: "bot-1",
    content: `${agentEventType} event`,
    metadata: {
      agentEventType,
      status: "running",
    },
  });
}

describe("computeRoundFoldMaps", () => {
  describe("channel type gating", () => {
    it("returns empty maps for non-DM channels (tracking)", () => {
      const msgs = [
        makeAgentEvent("a1"),
        makeAgentEvent("a2"),
        makeMessage("u1"),
        makeAgentEvent("a3"),
      ];
      const maps = computeRoundFoldMaps({
        channelType: "tracking",
        chronoMessages: msgs,
        userExpandedRounds: new Set(),
      });
      expect(maps.roundStateMap.size).toBe(0);
      expect(maps.messageRoundMap.size).toBe(0);
    });

    it("returns empty maps for public channels", () => {
      const msgs = [makeAgentEvent("a1"), makeMessage("u1")];
      const maps = computeRoundFoldMaps({
        channelType: "public",
        chronoMessages: msgs,
        userExpandedRounds: new Set(),
      });
      expect(maps.roundStateMap.size).toBe(0);
      expect(maps.messageRoundMap.size).toBe(0);
    });

    it("returns empty maps for private channels", () => {
      const maps = computeRoundFoldMaps({
        channelType: "private",
        chronoMessages: [makeAgentEvent("a1"), makeMessage("u1")],
        userExpandedRounds: new Set(),
      });
      expect(maps.roundStateMap.size).toBe(0);
      expect(maps.messageRoundMap.size).toBe(0);
    });

    it("returns empty maps for task channels", () => {
      const maps = computeRoundFoldMaps({
        channelType: "task",
        chronoMessages: [makeAgentEvent("a1"), makeMessage("u1")],
        userExpandedRounds: new Set(),
      });
      expect(maps.roundStateMap.size).toBe(0);
      expect(maps.messageRoundMap.size).toBe(0);
    });

    it("returns empty maps when channelType is undefined", () => {
      const maps = computeRoundFoldMaps({
        channelType: undefined,
        chronoMessages: [makeAgentEvent("a1"), makeMessage("u1")],
        userExpandedRounds: new Set(),
      });
      expect(maps.roundStateMap.size).toBe(0);
      expect(maps.messageRoundMap.size).toBe(0);
    });

    it("computes maps for direct channels", () => {
      const msgs = [
        makeAgentEvent("a1"),
        makeAgentEvent("a2"),
        makeMessage("u1"),
      ];
      const maps = computeRoundFoldMaps({
        channelType: "direct",
        chronoMessages: msgs,
        userExpandedRounds: new Set(),
      });
      expect(maps.roundStateMap.size).toBe(1);
      expect(maps.roundStateMap.get("a1")).toEqual({
        isFolded: true,
        firstMessageId: "a1",
        stepCount: 2,
      });
      expect(maps.messageRoundMap.get("a1")).toBe("a1");
      expect(maps.messageRoundMap.get("a2")).toBe("a1");
      expect(maps.messageRoundMap.has("u1")).toBe(false);
    });
  });

  describe("empty and trivial inputs", () => {
    it("handles empty chronoMessages", () => {
      const maps = computeRoundFoldMaps({
        channelType: "direct",
        chronoMessages: [],
        userExpandedRounds: new Set(),
      });
      expect(maps.roundStateMap.size).toBe(0);
      expect(maps.messageRoundMap.size).toBe(0);
    });

    it("does not fold a single round (it is the latest)", () => {
      const maps = computeRoundFoldMaps({
        channelType: "direct",
        chronoMessages: [makeAgentEvent("a1"), makeAgentEvent("a2")],
        userExpandedRounds: new Set(),
      });
      expect(maps.roundStateMap.size).toBe(0);
      expect(maps.messageRoundMap.size).toBe(0);
    });

    it("does not fold a lone user message", () => {
      const maps = computeRoundFoldMaps({
        channelType: "direct",
        chronoMessages: [makeMessage("u1")],
        userExpandedRounds: new Set(),
      });
      expect(maps.roundStateMap.size).toBe(0);
      expect(maps.messageRoundMap.size).toBe(0);
    });
  });

  describe("latest round handling", () => {
    it("leaves the trailing round expanded", () => {
      // [user] [agent round 1] [user] [agent round 2 = latest]
      const msgs = [
        makeMessage("u1"),
        makeAgentEvent("a1"),
        makeAgentEvent("a2"),
        makeMessage("u2"),
        makeAgentEvent("a3"),
        makeAgentEvent("a4"),
      ];
      const maps = computeRoundFoldMaps({
        channelType: "direct",
        chronoMessages: msgs,
        userExpandedRounds: new Set(),
      });
      // Only round 1 is folded; round 2 (trailing) is expanded.
      expect(maps.roundStateMap.size).toBe(1);
      expect(maps.roundStateMap.has("a1")).toBe(true);
      expect(maps.roundStateMap.has("a3")).toBe(false);
      expect(maps.messageRoundMap.get("a3")).toBeUndefined();
      expect(maps.messageRoundMap.get("a4")).toBeUndefined();
    });

    it("folds an old round when the trailing item is a user message", () => {
      const msgs = [
        makeAgentEvent("a1"),
        makeAgentEvent("a2"),
        makeMessage("u1"),
      ];
      const maps = computeRoundFoldMaps({
        channelType: "direct",
        chronoMessages: msgs,
        userExpandedRounds: new Set(),
      });
      expect(maps.roundStateMap.get("a1")).toEqual({
        isFolded: true,
        firstMessageId: "a1",
        stepCount: 2,
      });
    });
  });

  describe("user manual expansion", () => {
    it("excludes user-expanded rounds from the fold map", () => {
      const msgs = [
        makeAgentEvent("a1"),
        makeAgentEvent("a2"),
        makeMessage("u1"),
        makeAgentEvent("a3"),
        makeMessage("u2"),
      ];
      const maps = computeRoundFoldMaps({
        channelType: "direct",
        chronoMessages: msgs,
        userExpandedRounds: new Set(["a1"]),
      });
      // a1 round is manually expanded → not in maps
      expect(maps.roundStateMap.has("a1")).toBe(false);
      expect(maps.messageRoundMap.has("a1")).toBe(false);
      expect(maps.messageRoundMap.has("a2")).toBe(false);
      // a3 round is still folded
      expect(maps.roundStateMap.get("a3")?.isFolded).toBe(true);
    });

    it("ignores unknown roundIds in userExpandedRounds gracefully", () => {
      const msgs = [
        makeAgentEvent("a1"),
        makeMessage("u1"),
        makeAgentEvent("a2"),
      ];
      const maps = computeRoundFoldMaps({
        channelType: "direct",
        chronoMessages: msgs,
        userExpandedRounds: new Set(["ghost-round"]),
      });
      // a1 still folded (a2 is latest)
      expect(maps.roundStateMap.has("a1")).toBe(true);
    });
  });

  describe("multiple rounds", () => {
    it("folds every non-latest round independently", () => {
      // r1 (2 events), user, r2 (1 event), user, r3 (3 events), user, r4 latest (1)
      const msgs = [
        makeAgentEvent("r1-1"),
        makeAgentEvent("r1-2"),
        makeMessage("u1"),
        makeAgentEvent("r2-1"),
        makeMessage("u2"),
        makeAgentEvent("r3-1"),
        makeAgentEvent("r3-2"),
        makeAgentEvent("r3-3"),
        makeMessage("u3"),
        makeAgentEvent("r4-1"),
      ];
      const maps = computeRoundFoldMaps({
        channelType: "direct",
        chronoMessages: msgs,
        userExpandedRounds: new Set(),
      });
      expect(maps.roundStateMap.size).toBe(3);
      expect(maps.roundStateMap.get("r1-1")?.stepCount).toBe(2);
      expect(maps.roundStateMap.get("r2-1")?.stepCount).toBe(1);
      expect(maps.roundStateMap.get("r3-1")?.stepCount).toBe(3);
      expect(maps.roundStateMap.has("r4-1")).toBe(false);
      // message map covers every message in the 3 folded rounds
      expect(maps.messageRoundMap.get("r1-2")).toBe("r1-1");
      expect(maps.messageRoundMap.get("r3-3")).toBe("r3-1");
    });
  });

  describe("agent event types", () => {
    it("treats any agent event type as part of a round", () => {
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
      const msgs: Message[] = [
        ...types.map((t, i) => makeAgentEvent(`a${i}`, t)),
        makeMessage("u1"),
      ];
      const maps = computeRoundFoldMaps({
        channelType: "direct",
        chronoMessages: msgs,
        userExpandedRounds: new Set(),
      });
      // Single folded round containing all 10 agent events
      expect(maps.roundStateMap.size).toBe(1);
      const first = maps.roundStateMap.get("a0");
      // stepCount counts visible display rows — turn_separator renders as
      // null in TrackingEventItem, so it never contributes to the count.
      expect(first?.stepCount).toBe(types.length - 1);
    });
  });
});

describe("decideRoundRender", () => {
  function buildMaps(msgs: Message[], userExpandedRounds = new Set<string>()) {
    return computeRoundFoldMaps({
      channelType: "direct",
      chronoMessages: msgs,
      userExpandedRounds,
    });
  }

  it("returns 'none' for messages outside any folded round", () => {
    const msgs = [
      makeAgentEvent("a1"),
      makeAgentEvent("a2"),
      makeMessage("u1"),
      makeAgentEvent("a3"),
    ];
    const maps = buildMaps(msgs);
    // u1 is a regular message
    expect(decideRoundRender("u1", maps)).toEqual({ kind: "none" });
    // a3 is the latest round
    expect(decideRoundRender("a3", maps)).toEqual({ kind: "none" });
  });

  it("returns 'summary' for the first message of a folded round", () => {
    const msgs = [
      makeAgentEvent("a1"),
      makeAgentEvent("a2"),
      makeAgentEvent("a3"),
      makeMessage("u1"),
    ];
    const maps = buildMaps(msgs);
    expect(decideRoundRender("a1", maps)).toEqual({
      kind: "summary",
      roundId: "a1",
      stepCount: 3,
    });
  });

  it("returns 'hidden' for non-first messages of a folded round", () => {
    const msgs = [
      makeAgentEvent("a1"),
      makeAgentEvent("a2"),
      makeAgentEvent("a3"),
      makeMessage("u1"),
    ];
    const maps = buildMaps(msgs);
    expect(decideRoundRender("a2", maps)).toEqual({
      kind: "hidden",
      roundId: "a1",
    });
    expect(decideRoundRender("a3", maps)).toEqual({
      kind: "hidden",
      roundId: "a1",
    });
  });

  it("returns 'none' for unknown message ids", () => {
    const msgs = [makeAgentEvent("a1"), makeMessage("u1")];
    const maps = buildMaps(msgs);
    expect(decideRoundRender("nope", maps)).toEqual({ kind: "none" });
  });

  it("returns 'none' for all messages once the user expands the round", () => {
    const msgs = [
      makeAgentEvent("a1"),
      makeAgentEvent("a2"),
      makeMessage("u1"),
    ];
    const maps = buildMaps(msgs, new Set(["a1"]));
    expect(decideRoundRender("a1", maps)).toEqual({ kind: "none" });
    expect(decideRoundRender("a2", maps)).toEqual({ kind: "none" });
  });

  it("returns 'none' for non-DM channels (defensive)", () => {
    const maps = computeRoundFoldMaps({
      channelType: "public",
      chronoMessages: [
        makeAgentEvent("a1"),
        makeAgentEvent("a2"),
        makeMessage("u1"),
      ],
      userExpandedRounds: new Set(),
    });
    expect(decideRoundRender("a1", maps)).toEqual({ kind: "none" });
    expect(decideRoundRender("a2", maps)).toEqual({ kind: "none" });
  });

  it("returns 'none' (defensive) when message references a round missing from the state map", () => {
    // Hand-crafted maps that violate the invariant messageRoundMap ⊆ roundStateMap.
    // This exercises the `!state` safety branch inside decideRoundRender.
    const maps = {
      roundStateMap: new Map(),
      messageRoundMap: new Map([["orphan", "ghost-round"]]),
    };
    expect(decideRoundRender("orphan", maps)).toEqual({ kind: "none" });
  });

  it("returns 'none' (defensive) when the round entry is marked not folded", () => {
    // Another defensive path: a round exists but has isFolded=false.
    const maps = {
      roundStateMap: new Map([
        ["r1", { isFolded: false, firstMessageId: "m1", stepCount: 2 }],
      ]),
      messageRoundMap: new Map([
        ["m1", "r1"],
        ["m2", "r1"],
      ]),
    };
    expect(decideRoundRender("m1", maps)).toEqual({ kind: "none" });
    expect(decideRoundRender("m2", maps)).toEqual({ kind: "none" });
  });
});

describe("toggleExpandedRound", () => {
  it("adds a roundId when it is not already present", () => {
    const result = toggleExpandedRound(new Set(), "r1");
    expect(result.has("r1")).toBe(true);
    expect(result.size).toBe(1);
  });

  it("removes a roundId when it is already present", () => {
    const result = toggleExpandedRound(new Set(["r1"]), "r1");
    expect(result.has("r1")).toBe(false);
    expect(result.size).toBe(0);
  });

  it("leaves unrelated roundIds untouched", () => {
    const result = toggleExpandedRound(new Set(["r1", "r2"]), "r1");
    expect(result.has("r1")).toBe(false);
    expect(result.has("r2")).toBe(true);
  });

  it("returns a fresh Set (never mutates the input)", () => {
    const input = new Set(["r1"]);
    const output = toggleExpandedRound(input, "r2");
    expect(output).not.toBe(input);
    expect(input.has("r2")).toBe(false);
    expect(output.has("r1")).toBe(true);
    expect(output.has("r2")).toBe(true);
  });
});

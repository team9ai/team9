import { describe, it, expect } from "vitest";
import {
  normalizeReactions,
  normalizeMessage,
  normalizeMessages,
} from "../normalize-reactions";
import type { Message } from "@/types/im";

// Helper to build a minimal Message for testing
function makeMessage(overrides: Partial<Message> & { id: string }): Message {
  return {
    channelId: "ch-1",
    senderId: "sender-1",
    content: "hello",
    type: "text",
    isPinned: false,
    isEdited: false,
    isDeleted: false,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("normalizeReactions", () => {
  it("returns empty array for empty reactions", () => {
    expect(normalizeReactions("msg-1", [])).toEqual([]);
  });

  it("returns empty array for null/undefined reactions", () => {
    expect(normalizeReactions("msg-1", null as any)).toEqual([]);
    expect(normalizeReactions("msg-1", undefined as any)).toEqual([]);
  });

  it("converts aggregated format to individual reactions", () => {
    const aggregated = [{ emoji: "👍", count: 2, userIds: ["u1", "u2"] }];

    const result = normalizeReactions("msg-1", aggregated);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      messageId: "msg-1",
      userId: "u1",
      emoji: "👍",
    });
    expect(result[1]).toMatchObject({
      messageId: "msg-1",
      userId: "u2",
      emoji: "👍",
    });
  });

  it("generates deterministic IDs from messageId + userId + emoji", () => {
    const aggregated = [{ emoji: "🎉", count: 1, userIds: ["u1"] }];

    const result = normalizeReactions("msg-42", aggregated);

    expect(result[0].id).toBe("msg-42-u1-🎉");
  });

  it("handles multiple emojis with multiple users", () => {
    const aggregated = [
      { emoji: "👍", count: 2, userIds: ["u1", "u2"] },
      { emoji: "❤️", count: 1, userIds: ["u3"] },
    ];

    const result = normalizeReactions("msg-1", aggregated);

    expect(result).toHaveLength(3);
    expect(result.map((r) => `${r.userId}:${r.emoji}`)).toEqual([
      "u1:👍",
      "u2:👍",
      "u3:❤️",
    ]);
  });

  it("passes through individual format (from WebSocket events) unchanged", () => {
    const individual = [
      {
        id: "r1",
        messageId: "msg-1",
        userId: "u1",
        emoji: "👍",
        createdAt: "2025-01-01T00:00:00.000Z",
      },
      {
        id: "r2",
        messageId: "msg-1",
        userId: "u2",
        emoji: "👍",
        createdAt: "2025-01-01T00:00:00.000Z",
      },
    ];

    const result = normalizeReactions("msg-1", individual);

    expect(result).toBe(individual); // same reference, not transformed
  });
});

describe("normalizeMessage", () => {
  it("returns message as-is when no reactions", () => {
    const msg = makeMessage({ id: "msg-1" });
    expect(normalizeMessage(msg)).toBe(msg); // same reference
  });

  it("returns message as-is when reactions is undefined", () => {
    const msg = makeMessage({ id: "msg-1", reactions: undefined });
    expect(normalizeMessage(msg)).toBe(msg);
  });

  it("normalizes aggregated reactions on a message", () => {
    const msg = makeMessage({
      id: "msg-1",
      reactions: [{ emoji: "👍", count: 2, userIds: ["u1", "u2"] } as any],
    });

    const result = normalizeMessage(msg);

    expect(result.reactions).toHaveLength(2);
    expect(result.reactions![0].userId).toBe("u1");
    expect(result.reactions![1].userId).toBe("u2");
  });

  it("does not mutate the original message", () => {
    const original = [{ emoji: "👍", count: 1, userIds: ["u1"] } as any];
    const msg = makeMessage({ id: "msg-1", reactions: original });

    const result = normalizeMessage(msg);

    expect(result).not.toBe(msg);
    expect(msg.reactions).toBe(original); // original unchanged
  });
});

describe("normalizeMessages", () => {
  it("normalizes reactions on all messages", () => {
    const messages = [
      makeMessage({
        id: "msg-1",
        reactions: [{ emoji: "👍", count: 1, userIds: ["u1"] } as any],
      }),
      makeMessage({ id: "msg-2" }), // no reactions
      makeMessage({
        id: "msg-3",
        reactions: [{ emoji: "❤️", count: 2, userIds: ["u2", "u3"] } as any],
      }),
    ];

    const result = normalizeMessages(messages);

    expect(result[0].reactions).toHaveLength(1);
    expect(result[0].reactions![0].userId).toBe("u1");
    expect(result[1].reactions).toBeUndefined();
    expect(result[2].reactions).toHaveLength(2);
    expect(result[2].reactions![0].userId).toBe("u2");
    expect(result[2].reactions![1].userId).toBe("u3");
  });
});

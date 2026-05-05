import { describe, it, expect } from "vitest";
import type { Message } from "@/types/im";
import { isForwardable, computeForwardableRange } from "../eligibility";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeMsg(id: string, overrides: Partial<Message> = {}): Message {
  return {
    id,
    channelId: "ch-1",
    senderId: "u-1",
    content: "hello",
    type: "text",
    isPinned: false,
    isEdited: false,
    isDeleted: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

// ── isForwardable ─────────────────────────────────────────────────────────────

describe("isForwardable", () => {
  describe("allowed types return true", () => {
    it.each(["text", "long_text", "file", "image", "forward"] as const)(
      "returns true for type=%s",
      (type) => {
        expect(isForwardable(makeMsg("m1", { type }))).toBe(true);
      },
    );
  });

  describe("disallowed types return false", () => {
    it.each(["system", "tracking"] as const)(
      "returns false for type=%s",
      (type) => {
        expect(isForwardable(makeMsg("m1", { type }))).toBe(false);
      },
    );
  });

  it("returns false when isDeleted is true", () => {
    expect(isForwardable(makeMsg("m1", { isDeleted: true }))).toBe(false);
  });

  it("returns false when metadata.streaming === true", () => {
    expect(
      isForwardable(makeMsg("m1", { metadata: { streaming: true } })),
    ).toBe(false);
  });

  it("returns true when metadata.streaming is falsy (false)", () => {
    expect(
      isForwardable(makeMsg("m1", { metadata: { streaming: false } })),
    ).toBe(true);
  });

  it("returns true when metadata is absent", () => {
    expect(isForwardable(makeMsg("m1", { metadata: undefined }))).toBe(true);
  });

  it("isDeleted check takes precedence over type check", () => {
    // even an allowed type is blocked when deleted
    expect(
      isForwardable(makeMsg("m1", { type: "text", isDeleted: true })),
    ).toBe(false);
  });
});

// ── computeForwardableRange ───────────────────────────────────────────────────

describe("computeForwardableRange", () => {
  const msgs = [
    makeMsg("a"),
    makeMsg("b"),
    makeMsg("c"),
    makeMsg("d"),
    makeMsg("e"),
  ];

  it("forward direction returns inclusive slice in original order", () => {
    expect(computeForwardableRange(msgs, "b", "d")).toEqual(["b", "c", "d"]);
  });

  it("reverse direction returns inclusive slice in original order", () => {
    expect(computeForwardableRange(msgs, "d", "b")).toEqual(["b", "c", "d"]);
  });

  it("filters out ineligible messages within the range", () => {
    const withDeleted = [
      makeMsg("a"),
      makeMsg("b", { isDeleted: true }),
      makeMsg("c"),
      makeMsg("d"),
    ];
    expect(computeForwardableRange(withDeleted, "a", "d")).toEqual([
      "a",
      "c",
      "d",
    ]);
  });

  it("returns [] when fromId is not found", () => {
    expect(computeForwardableRange(msgs, "MISSING", "d")).toEqual([]);
  });

  it("returns [] when toId is not found", () => {
    expect(computeForwardableRange(msgs, "a", "MISSING")).toEqual([]);
  });

  it("returns [single] when fromId === toId", () => {
    expect(computeForwardableRange(msgs, "c", "c")).toEqual(["c"]);
  });

  it("returns [] for empty message list", () => {
    expect(computeForwardableRange([], "a", "b")).toEqual([]);
  });

  it("returns [] when single-id target is ineligible", () => {
    const withSystem = [makeMsg("x", { type: "system" })];
    expect(computeForwardableRange(withSystem, "x", "x")).toEqual([]);
  });
});

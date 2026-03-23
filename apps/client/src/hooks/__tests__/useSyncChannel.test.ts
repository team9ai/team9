import { describe, it, expect } from "vitest";
import { mergeSyncedMessages, syncItemToMessage } from "../useSyncChannel";
import type { SyncMessageItem } from "@/types/im";

// Helper to create a minimal SyncMessageItem
function makeSyncItem(overrides: Partial<SyncMessageItem>): SyncMessageItem {
  return {
    id: "msg-1",
    channelId: "ch-1",
    senderId: "user-1",
    parentId: null,
    rootId: null,
    content: "hello",
    type: "text",
    seqId: "1",
    isPinned: false,
    isEdited: false,
    isDeleted: false,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    ...overrides,
  };
}

describe("syncItemToMessage", () => {
  it("passes through isDeleted=true", () => {
    const item = makeSyncItem({ isDeleted: true });
    const msg = syncItemToMessage(item);
    expect(msg.isDeleted).toBe(true);
  });

  it("defaults isDeleted to false when undefined", () => {
    const item = makeSyncItem({});
    // @ts-ignore - simulate old API response without isDeleted
    delete (item as any).isDeleted;
    const msg = syncItemToMessage(item);
    expect(msg.isDeleted).toBe(false);
  });

  it("converts senderId null to empty string", () => {
    const item = makeSyncItem({ senderId: null });
    const msg = syncItemToMessage(item);
    expect(msg.senderId).toBe("");
  });

  it("converts parentId null to undefined", () => {
    const item = makeSyncItem({ parentId: null });
    const msg = syncItemToMessage(item);
    expect(msg.parentId).toBeUndefined();
  });

  it("preserves sender information when present", () => {
    const item = makeSyncItem({
      sender: {
        id: "user-1",
        username: "alice",
        displayName: "Alice",
        avatarUrl: null,
      },
    });
    const msg = syncItemToMessage(item);
    expect(msg.sender?.username).toBe("alice");
    expect(msg.sender?.displayName).toBe("Alice");
  });
});

describe("mergeSyncedMessages", () => {
  it("identifies new main messages", () => {
    const synced = [makeSyncItem({ id: "new-1" })];
    const result = mergeSyncedMessages(synced);
    expect(result.mainUpdates.newMessages).toHaveLength(1);
    expect(result.mainUpdates.newMessages[0].id).toBe("new-1");
  });

  it("identifies edited main messages (same ID, isEdited=true)", () => {
    const synced = [
      makeSyncItem({ id: "msg-1", content: "edited", isEdited: true }),
    ];
    const result = mergeSyncedMessages(synced);
    expect(result.mainUpdates.editedMessages.get("msg-1")?.content).toBe(
      "edited",
    );
  });

  it("identifies deleted main messages", () => {
    const synced = [makeSyncItem({ id: "msg-1", isDeleted: true })];
    const result = mergeSyncedMessages(synced);
    expect(result.mainUpdates.deletedIds.has("msg-1")).toBe(true);
  });

  it("routes new, non-deleted, non-edited main messages to newMessages", () => {
    const synced = [
      makeSyncItem({ id: "a", isEdited: false, isDeleted: false }),
    ];
    const result = mergeSyncedMessages(synced);
    expect(result.mainUpdates.newMessages).toHaveLength(1);
    expect(result.mainUpdates.editedMessages.size).toBe(0);
    expect(result.mainUpdates.deletedIds.size).toBe(0);
  });

  it("routes first-level replies to threadUpdates by rootId", () => {
    const synced = [
      makeSyncItem({ id: "reply-1", parentId: "root-1", rootId: "root-1" }),
    ];
    const result = mergeSyncedMessages(synced);
    expect(result.threadUpdates.has("root-1")).toBe(true);
    expect(result.threadUpdates.get("root-1")!.new).toHaveLength(1);
  });

  it("routes sub-replies to subReplyUpdates by parentReplyId (NOT rootId)", () => {
    const synced = [
      makeSyncItem({ id: "sub-1", parentId: "reply-1", rootId: "root-1" }),
    ];
    const result = mergeSyncedMessages(synced);
    // Key should be parentReplyId ("reply-1"), not rootId ("root-1")
    expect(result.subReplyUpdates.has("reply-1")).toBe(true);
    expect(result.subReplyUpdates.get("reply-1")!.new).toHaveLength(1);
  });

  it("handles deleted first-level replies", () => {
    const synced = [
      makeSyncItem({
        id: "reply-1",
        parentId: "root-1",
        rootId: "root-1",
        isDeleted: true,
      }),
    ];
    const result = mergeSyncedMessages(synced);
    expect(result.threadUpdates.get("root-1")!.deletedIds.has("reply-1")).toBe(
      true,
    );
  });

  it("handles deleted sub-replies", () => {
    const synced = [
      makeSyncItem({
        id: "sub-1",
        parentId: "reply-1",
        rootId: "root-1",
        isDeleted: true,
      }),
    ];
    const result = mergeSyncedMessages(synced);
    expect(result.subReplyUpdates.get("reply-1")!.deletedIds.has("sub-1")).toBe(
      true,
    );
  });

  it("handles edited first-level replies", () => {
    const synced = [
      makeSyncItem({
        id: "reply-1",
        parentId: "root-1",
        rootId: "root-1",
        content: "edited reply",
        isEdited: true,
      }),
    ];
    const result = mergeSyncedMessages(synced);
    expect(
      result.threadUpdates.get("root-1")!.edited.get("reply-1")?.content,
    ).toBe("edited reply");
  });

  it("handles edited sub-replies", () => {
    const synced = [
      makeSyncItem({
        id: "sub-1",
        parentId: "reply-1",
        rootId: "root-1",
        content: "edited sub",
        isEdited: true,
      }),
    ];
    const result = mergeSyncedMessages(synced);
    expect(
      result.subReplyUpdates.get("reply-1")!.edited.get("sub-1")?.content,
    ).toBe("edited sub");
  });

  it("handles mixed batch across main + thread + sub-reply", () => {
    const synced = [
      makeSyncItem({ id: "msg-1", content: "edited", isEdited: true }),
      makeSyncItem({ id: "msg-2", isDeleted: true }),
      makeSyncItem({ id: "new-1", content: "brand new" }),
      makeSyncItem({ id: "reply-1", parentId: "root-1", rootId: "root-1" }),
      makeSyncItem({
        id: "sub-1",
        parentId: "reply-1",
        rootId: "root-1",
        isDeleted: true,
      }),
    ];
    const result = mergeSyncedMessages(synced);
    expect(result.mainUpdates.newMessages).toHaveLength(1);
    expect(result.mainUpdates.editedMessages.size).toBe(1);
    expect(result.mainUpdates.deletedIds.size).toBe(1);
    expect(result.threadUpdates.get("root-1")!.new).toHaveLength(1);
    expect(result.subReplyUpdates.get("reply-1")!.deletedIds.size).toBe(1);
  });

  it("returns empty results for an empty input array", () => {
    const result = mergeSyncedMessages([]);
    expect(result.mainUpdates.newMessages).toHaveLength(0);
    expect(result.mainUpdates.editedMessages.size).toBe(0);
    expect(result.mainUpdates.deletedIds.size).toBe(0);
    expect(result.threadUpdates.size).toBe(0);
    expect(result.subReplyUpdates.size).toBe(0);
  });

  it("groups multiple first-level replies under the same rootId", () => {
    const synced = [
      makeSyncItem({ id: "reply-1", parentId: "root-1", rootId: "root-1" }),
      makeSyncItem({ id: "reply-2", parentId: "root-1", rootId: "root-1" }),
    ];
    const result = mergeSyncedMessages(synced);
    expect(result.threadUpdates.get("root-1")!.new).toHaveLength(2);
  });

  it("groups multiple sub-replies under the same parentReplyId", () => {
    const synced = [
      makeSyncItem({ id: "sub-1", parentId: "reply-1", rootId: "root-1" }),
      makeSyncItem({ id: "sub-2", parentId: "reply-1", rootId: "root-1" }),
    ];
    const result = mergeSyncedMessages(synced);
    expect(result.subReplyUpdates.get("reply-1")!.new).toHaveLength(2);
  });
});

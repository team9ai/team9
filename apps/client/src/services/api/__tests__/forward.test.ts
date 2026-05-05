import { beforeEach, describe, expect, it, vi } from "vitest";

const mockHttp = vi.hoisted(() => ({
  post: vi.fn(),
  get: vi.fn(),
}));

vi.mock("../../http", () => ({
  default: mockHttp,
}));

vi.mock("../normalize-reactions", () => ({
  normalizeMessage: (m: unknown) => ({ ...(m as object), normalized: true }),
}));

import forwardApi from "../forward";

describe("forwardApi.create", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHttp.post.mockResolvedValue({ data: { id: "new-msg-1" } });
  });

  it("posts to the correct URL with the request body", async () => {
    await forwardApi.create({
      targetChannelId: "ch-target",
      sourceChannelId: "ch-source",
      sourceMessageIds: ["m-1", "m-2"],
      clientMsgId: "cid-7",
    });

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/v1/im/channels/ch-target/forward",
      {
        sourceChannelId: "ch-source",
        sourceMessageIds: ["m-1", "m-2"],
        clientMsgId: "cid-7",
      },
    );
  });

  it("omits clientMsgId from the body when not provided (passes undefined)", async () => {
    await forwardApi.create({
      targetChannelId: "ch-1",
      sourceChannelId: "ch-2",
      sourceMessageIds: ["m-1"],
    });

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/v1/im/channels/ch-1/forward",
      expect.objectContaining({ clientMsgId: undefined }),
    );
  });

  it("returns the response data passed through normalizeMessage", async () => {
    mockHttp.post.mockResolvedValueOnce({
      data: { id: "raw", reactions: [] },
    });
    const result = await forwardApi.create({
      targetChannelId: "ch-1",
      sourceChannelId: "ch-2",
      sourceMessageIds: ["m-1"],
    });
    expect(result).toMatchObject({ id: "raw", normalized: true });
  });

  it("propagates http errors", async () => {
    mockHttp.post.mockRejectedValueOnce(new Error("forward.noWriteAccess"));
    await expect(
      forwardApi.create({
        targetChannelId: "ch-1",
        sourceChannelId: "ch-2",
        sourceMessageIds: ["m-1"],
      }),
    ).rejects.toThrow("forward.noWriteAccess");
  });
});

describe("forwardApi.getItems", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("gets the correct URL", async () => {
    mockHttp.get.mockResolvedValueOnce({ data: [] });
    await forwardApi.getItems("msg-42");
    expect(mockHttp.get).toHaveBeenCalledWith(
      "/v1/im/messages/msg-42/forward-items",
    );
  });

  it("returns the response data array as-is", async () => {
    const items = [
      { position: 0, sourceMessageId: "x" },
      { position: 1, sourceMessageId: "y" },
    ];
    mockHttp.get.mockResolvedValueOnce({ data: items });
    const result = await forwardApi.getItems("msg-42");
    expect(result).toEqual(items);
  });

  it("propagates http errors", async () => {
    mockHttp.get.mockRejectedValueOnce(new Error("forward.notFound"));
    await expect(forwardApi.getItems("msg-missing")).rejects.toThrow(
      "forward.notFound",
    );
  });
});

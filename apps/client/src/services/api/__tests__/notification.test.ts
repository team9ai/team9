import { beforeEach, describe, expect, it, vi } from "vitest";

const mockHttp = vi.hoisted(() => ({
  post: vi.fn(),
  get: vi.fn(),
}));

vi.mock("../../http", () => ({
  default: mockHttp,
}));

import notificationApi from "../notification";

describe("notificationApi.markAllAsRead", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHttp.post.mockResolvedValue({ data: undefined });
  });

  it("omits empty types from request params", async () => {
    await notificationApi.markAllAsRead("message", []);

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/v1/notifications/mark-all-read",
      undefined,
      {
        params: {
          category: "message",
          types: undefined,
        },
      },
    );
    expect(mockHttp.post.mock.calls[0][2]?.params?.types).toBeUndefined();
  });
});

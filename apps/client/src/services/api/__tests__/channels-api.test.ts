import { beforeEach, describe, expect, it, vi } from "vitest";

const mockHttp = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("../../http", () => ({
  default: mockHttp,
}));

vi.mock("@/lib/tauri", () => ({ isTauriApp: vi.fn() }));
vi.mock("@/stores/useAhandStore", () => ({
  useAhandStore: { getState: vi.fn() },
}));
vi.mock("@/stores/useAppStore", () => ({
  useAppStore: { getState: vi.fn() },
}));
vi.mock("../normalize-reactions", () => ({
  normalizeMessage: (message: unknown) => message,
  normalizeMessages: (messages: unknown) => messages,
}));

import { CHANNEL_DETAIL_TIMEOUT_MS, channelsApi } from "../im";

describe("channelsApi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses a shorter timeout for loading one channel detail", async () => {
    const channel = { id: "ch-1", name: "general", type: "public" };
    mockHttp.get.mockResolvedValueOnce({ data: channel });

    const result = await channelsApi.getChannel("ch-1");

    expect(mockHttp.get).toHaveBeenCalledWith("/v1/im/channels/ch-1", {
      timeout: CHANNEL_DETAIL_TIMEOUT_MS,
    });
    expect(result).toBe(channel);
  });
});

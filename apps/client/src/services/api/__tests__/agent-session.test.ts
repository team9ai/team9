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

import { channelsApi } from "../im";

describe("channelsApi agent session endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getAgentSession calls the channel agent-session endpoint and unwraps data", async () => {
    const payload = {
      channelId: "ch-1",
      channelType: "direct",
      kind: "dm",
      supported: true,
      tenantId: "tenant-1",
      agentId: "agent-1",
      botUserId: "bot-1",
      sessionId: "session-1",
    };
    mockHttp.get.mockResolvedValueOnce({ data: payload });

    const result = await channelsApi.getAgentSession("ch-1");

    expect(mockHttp.get).toHaveBeenCalledWith(
      "/v1/im/channels/ch-1/agent-session",
    );
    expect(result).toBe(payload);
  });

  it("getAgentSessionComponents calls the channel components endpoint and unwraps data", async () => {
    const payload = {
      sessionId: "session-1",
      components: [
        {
          id: "component-1",
          typeKey: "summary",
          runtimeInjectedOnly: false,
          latestData: {
            data: { text: "hello" },
            capturedAtCallId: null,
            capturedAt: 123,
          },
        },
      ],
    };
    mockHttp.get.mockResolvedValueOnce({ data: payload });

    const result = await channelsApi.getAgentSessionComponents("ch-1");

    expect(mockHttp.get).toHaveBeenCalledWith(
      "/v1/im/channels/ch-1/agent-session/components",
    );
    expect(result).toBe(payload);
  });

  it("pauseAgentSession calls the channel pause endpoint", async () => {
    mockHttp.post.mockResolvedValueOnce({ data: {} });

    await channelsApi.pauseAgentSession("ch-1");

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/v1/im/channels/ch-1/agent-session/pause",
      {},
    );
  });

  it("resumeAgentSession calls the channel resume endpoint", async () => {
    mockHttp.post.mockResolvedValueOnce({ data: {} });

    await channelsApi.resumeAgentSession("ch-1");

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/v1/im/channels/ch-1/agent-session/resume",
      {},
    );
  });
});

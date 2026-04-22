import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock modules before importing the module under test
vi.mock("@/lib/tauri", () => ({ isTauriApp: vi.fn() }));
vi.mock("@/stores/useAhandStore", () => ({
  useAhandStore: { getState: vi.fn() },
}));
vi.mock("@/stores/useAppStore", () => ({
  useAppStore: { getState: vi.fn() },
}));
vi.mock("@/services/http", () => ({
  default: {
    post: vi.fn().mockResolvedValue({ data: { id: "m1" } }),
    get: vi.fn().mockResolvedValue({ data: {} }),
    patch: vi.fn().mockResolvedValue({ data: {} }),
    delete: vi.fn().mockResolvedValue({ data: {} }),
  },
}));
vi.mock("@/services/api/normalize-reactions", () => ({
  normalizeMessage: (m: unknown) => m,
  normalizeMessages: (msgs: unknown) => msgs,
}));

import { isTauriApp } from "@/lib/tauri";
import { useAhandStore } from "@/stores/useAhandStore";
import { useAppStore } from "@/stores/useAppStore";
import http from "@/services/http";

describe("sendMessage clientContext injection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("web build attaches kind:web", async () => {
    vi.mocked(isTauriApp).mockReturnValue(false);
    const { messagesApi } = await import("../im");
    await messagesApi.sendMessage("ch1", { content: "hello" });
    expect(http.post).toHaveBeenCalledWith(
      "/v1/im/channels/ch1/messages",
      expect.objectContaining({ clientContext: { kind: "web" } }),
    );
  });

  it("Tauri build with no user attaches kind:macapp + deviceId:null", async () => {
    vi.mocked(isTauriApp).mockReturnValue(true);
    vi.mocked(useAppStore.getState).mockReturnValue({ user: null } as any);
    const { messagesApi } = await import("../im");
    await messagesApi.sendMessage("ch1", { content: "hello" });
    expect(http.post).toHaveBeenCalledWith(
      "/v1/im/channels/ch1/messages",
      expect.objectContaining({
        clientContext: { kind: "macapp", deviceId: null },
      }),
    );
  });

  it("Tauri build with enabled ahand includes deviceId", async () => {
    vi.mocked(isTauriApp).mockReturnValue(true);
    vi.mocked(useAppStore.getState).mockReturnValue({
      user: { id: "u1" },
    } as any);
    vi.mocked(useAhandStore.getState).mockReturnValue({
      getDeviceIdForUser: () => "dev-abc",
    } as any);
    const { messagesApi } = await import("../im");
    await messagesApi.sendMessage("ch1", { content: "hello" });
    expect(http.post).toHaveBeenCalledWith(
      "/v1/im/channels/ch1/messages",
      expect.objectContaining({
        clientContext: { kind: "macapp", deviceId: "dev-abc" },
      }),
    );
  });

  it("Tauri build with ahand disabled sends deviceId:null", async () => {
    vi.mocked(isTauriApp).mockReturnValue(true);
    vi.mocked(useAppStore.getState).mockReturnValue({
      user: { id: "u1" },
    } as any);
    vi.mocked(useAhandStore.getState).mockReturnValue({
      getDeviceIdForUser: () => null,
    } as any);
    const { messagesApi } = await import("../im");
    await messagesApi.sendMessage("ch1", { content: "hello" });
    expect(http.post).toHaveBeenCalledWith(
      "/v1/im/channels/ch1/messages",
      expect.objectContaining({
        clientContext: { kind: "macapp", deviceId: null },
      }),
    );
  });

  it("auto-injected clientContext overrides caller-supplied value (server is authoritative)", async () => {
    // buildClientContext() always runs and takes precedence over any caller-supplied
    // clientContext — the server is the source of truth for client attribution.
    vi.mocked(isTauriApp).mockReturnValue(false);
    const { messagesApi } = await import("../im");
    await messagesApi.sendMessage("ch1", {
      content: "hi",
      clientContext: { kind: "macapp", deviceId: "override" },
    });
    // In web env, buildClientContext returns { kind: "web" }, overriding the caller
    expect(http.post).toHaveBeenCalledWith(
      "/v1/im/channels/ch1/messages",
      expect.objectContaining({ clientContext: { kind: "web" } }),
    );
  });
});

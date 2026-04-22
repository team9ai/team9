import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/services/http", () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

import http from "@/services/http";
import { ahandApi } from "./ahand-api";

describe("ahandApi", () => {
  beforeEach(() => vi.clearAllMocks());

  it("list() omits query string by default", async () => {
    vi.mocked(http.get).mockResolvedValue({ data: [] } as any);
    await ahandApi.list();
    expect(http.get).toHaveBeenCalledWith("/api/ahand/devices");
  });

  it("list() passes includeOffline=false as query string", async () => {
    vi.mocked(http.get).mockResolvedValue({ data: [] } as any);
    await ahandApi.list({ includeOffline: false });
    expect(http.get).toHaveBeenCalledWith(
      "/api/ahand/devices?includeOffline=false",
    );
  });

  it("list() omits query string when includeOffline=true", async () => {
    vi.mocked(http.get).mockResolvedValue({ data: [] } as any);
    await ahandApi.list({ includeOffline: true });
    expect(http.get).toHaveBeenCalledWith("/api/ahand/devices");
  });

  it("register POSTs to /api/ahand/devices with body", async () => {
    vi.mocked(http.post).mockResolvedValue({ data: {} } as any);
    await ahandApi.register({
      hubDeviceId: "d",
      publicKey: "p",
      nickname: "n",
      platform: "macos",
    });
    expect(http.post).toHaveBeenCalledWith(
      "/api/ahand/devices",
      expect.objectContaining({ hubDeviceId: "d" }),
    );
  });

  it("refreshToken URL-encodes id with spaces", async () => {
    vi.mocked(http.post).mockResolvedValue({ data: {} } as any);
    await ahandApi.refreshToken("id with space");
    expect(http.post).toHaveBeenCalledWith(
      "/api/ahand/devices/id%20with%20space/token/refresh",
    );
  });

  it("refreshToken normal id is not encoded", async () => {
    vi.mocked(http.post).mockResolvedValue({ data: {} } as any);
    await ahandApi.refreshToken("abc123");
    expect(http.post).toHaveBeenCalledWith(
      "/api/ahand/devices/abc123/token/refresh",
    );
  });

  it("patch sends body", async () => {
    vi.mocked(http.patch).mockResolvedValue({ data: {} } as any);
    await ahandApi.patch("id1", { nickname: "new" });
    expect(http.patch).toHaveBeenCalledWith("/api/ahand/devices/id1", {
      nickname: "new",
    });
  });

  it("remove calls DELETE", async () => {
    vi.mocked(http.delete).mockResolvedValue({ data: {} } as any);
    await ahandApi.remove("id1");
    expect(http.delete).toHaveBeenCalledWith("/api/ahand/devices/id1");
  });

  it("remove resolves to undefined", async () => {
    vi.mocked(http.delete).mockResolvedValue({ data: {} } as any);
    const result = await ahandApi.remove("id1");
    expect(result).toBeUndefined();
  });
});

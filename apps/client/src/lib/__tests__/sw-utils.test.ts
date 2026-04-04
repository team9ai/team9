import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  probeTauri,
  isViewingChannel,
  buildNotificationOptions,
  TAURI_HEALTH_URL,
} from "../sw-utils";

describe("probeTauri", () => {
  it("returns true when fetch responds with ok status", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });

    const result = await probeTauri(mockFetch);

    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(TAURI_HEALTH_URL, {
      signal: expect.any(AbortSignal),
    });
  });

  it("returns false when fetch responds with non-ok status", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false });

    const result = await probeTauri(mockFetch);

    expect(result).toBe(false);
  });

  it("returns false when fetch throws (network error)", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new TypeError("fetch failed"));

    const result = await probeTauri(mockFetch);

    expect(result).toBe(false);
  });

  it("returns false when fetch throws abort error (timeout)", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new DOMException("AbortError"));

    const result = await probeTauri(mockFetch);

    expect(result).toBe(false);
  });
});

describe("isViewingChannel", () => {
  const NOW = 1700000000000;

  it("returns false when channelId is null", () => {
    expect(isViewingChannel(null, "ch-1", NOW - 1000, NOW)).toBe(false);
  });

  it("returns false when channelId is empty string", () => {
    expect(isViewingChannel("", "ch-1", NOW - 1000, NOW)).toBe(false);
  });

  it("returns false when heartbeat is stale (> 10 seconds)", () => {
    const staleHeartbeat = NOW - 11_000;
    expect(isViewingChannel("ch-1", "ch-1", staleHeartbeat, NOW)).toBe(false);
  });

  it("returns false when heartbeat is exactly 10 seconds old (boundary)", () => {
    const exactBoundary = NOW - 10_001;
    expect(isViewingChannel("ch-1", "ch-1", exactBoundary, NOW)).toBe(false);
  });

  it("returns true when heartbeat is fresh and channels match", () => {
    const freshHeartbeat = NOW - 5000;
    expect(isViewingChannel("ch-1", "ch-1", freshHeartbeat, NOW)).toBe(true);
  });

  it("returns false when heartbeat is fresh but channels do not match", () => {
    const freshHeartbeat = NOW - 5000;
    expect(isViewingChannel("ch-1", "ch-2", freshHeartbeat, NOW)).toBe(false);
  });

  it("returns false when activeChannelId is null", () => {
    const freshHeartbeat = NOW - 5000;
    expect(isViewingChannel("ch-1", null, freshHeartbeat, NOW)).toBe(false);
  });

  it("returns true at exact 10-second boundary (not stale yet)", () => {
    const justInTime = NOW - 10_000;
    expect(isViewingChannel("ch-1", "ch-1", justInTime, NOW)).toBe(true);
  });

  it("returns true when heartbeat is 0ms ago", () => {
    expect(isViewingChannel("ch-1", "ch-1", NOW, NOW)).toBe(true);
  });
});

describe("buildNotificationOptions", () => {
  it("builds options with all fields provided", () => {
    const result = buildNotificationOptions({
      body: "Hello world",
      id: "notif-123",
      actionUrl: "/channels/ch-1",
    });

    expect(result).toEqual({
      body: "Hello world",
      icon: "/team9-block.png",
      badge: "/team9-badge.png",
      tag: "notif-123",
      renotify: false,
      data: { actionUrl: "/channels/ch-1", id: "notif-123" },
    });
  });

  it("defaults body to empty string when not provided", () => {
    const result = buildNotificationOptions({ id: "n-1" });

    expect(result.body).toBe("");
  });

  it("defaults body to empty string when body is empty", () => {
    const result = buildNotificationOptions({ body: "", id: "n-2" });

    expect(result.body).toBe("");
  });

  it("handles missing id and actionUrl gracefully", () => {
    const result = buildNotificationOptions({});

    expect(result.tag).toBeUndefined();
    expect(result.data).toEqual({ actionUrl: undefined, id: undefined });
  });

  it("always sets renotify to false", () => {
    const result = buildNotificationOptions({ id: "n-3" });

    expect(result.renotify).toBe(false);
  });

  it("always uses the correct icon and badge paths", () => {
    const result = buildNotificationOptions({});

    expect(result.icon).toBe("/team9-block.png");
    expect(result.badge).toBe("/team9-badge.png");
  });
});

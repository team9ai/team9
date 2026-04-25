import { beforeEach, describe, expect, it } from "vitest";
import { useAhandStore } from "../useAhandStore";

describe("useAhandStore", () => {
  beforeEach(() => {
    useAhandStore.setState({ usersEnabled: {} });
  });

  // ── setDeviceIdForUser ──────────────────────────────────────────────────

  it("sets enabled + deviceId + hubUrl for a user", () => {
    useAhandStore
      .getState()
      .setDeviceIdForUser("u1", "dev-abc", true, "wss://hub.example.com");
    const entry = useAhandStore.getState().usersEnabled["u1"];
    expect(entry).toEqual({
      enabled: true,
      deviceId: "dev-abc",
      hubUrl: "wss://hub.example.com",
    });
  });

  it("preserves existing hubUrl when not supplied", () => {
    useAhandStore
      .getState()
      .setDeviceIdForUser("u1", "dev-abc", true, "wss://hub.example.com");
    useAhandStore.getState().setDeviceIdForUser("u1", "dev-abc", false);
    expect(useAhandStore.getState().usersEnabled["u1"].hubUrl).toBe(
      "wss://hub.example.com",
    );
  });

  it("defaults hubUrl to empty string when neither supplied nor prev exists", () => {
    useAhandStore.getState().setDeviceIdForUser("u1", "dev-abc", true);
    expect(useAhandStore.getState().usersEnabled["u1"].hubUrl).toBe("");
  });

  it("overwrites hubUrl when explicitly supplied", () => {
    useAhandStore
      .getState()
      .setDeviceIdForUser("u1", "dev-abc", true, "wss://old.example.com");
    useAhandStore
      .getState()
      .setDeviceIdForUser("u1", "dev-abc", true, "wss://new.example.com");
    expect(useAhandStore.getState().usersEnabled["u1"].hubUrl).toBe(
      "wss://new.example.com",
    );
  });

  it("updates multiple users independently", () => {
    useAhandStore.getState().setDeviceIdForUser("u1", "dev-1", true);
    useAhandStore.getState().setDeviceIdForUser("u2", "dev-2", false);
    expect(useAhandStore.getState().usersEnabled["u1"].enabled).toBe(true);
    expect(useAhandStore.getState().usersEnabled["u2"].enabled).toBe(false);
  });

  // ── getDeviceIdForUser ──────────────────────────────────────────────────

  it("returns deviceId when enabled=true", () => {
    useAhandStore.getState().setDeviceIdForUser("u1", "dev-abc", true);
    expect(useAhandStore.getState().getDeviceIdForUser("u1")).toBe("dev-abc");
  });

  it("returns the stored deviceId regardless of enabled (UI tracks 'this Mac' even when toggled off)", () => {
    useAhandStore.getState().setDeviceIdForUser("u1", "dev-abc", false);
    expect(useAhandStore.getState().getDeviceIdForUser("u1")).toBe("dev-abc");
  });

  it("returns null for unknown user", () => {
    expect(useAhandStore.getState().getDeviceIdForUser("unknown")).toBeNull();
  });

  it("returns null when deviceId is null and enabled=true", () => {
    useAhandStore.getState().setDeviceIdForUser("u1", null, true);
    expect(useAhandStore.getState().getDeviceIdForUser("u1")).toBeNull();
  });

  // ── getHubUrlForUser ────────────────────────────────────────────────────

  it("returns stored hubUrl for known user", () => {
    useAhandStore
      .getState()
      .setDeviceIdForUser("u1", "dev-abc", true, "wss://hub.example.com");
    expect(useAhandStore.getState().getHubUrlForUser("u1")).toBe(
      "wss://hub.example.com",
    );
  });

  it("returns empty string fallback for unknown user", () => {
    expect(useAhandStore.getState().getHubUrlForUser("unknown")).toBe("");
  });

  // ── clearUser ───────────────────────────────────────────────────────────

  it("removes only the target user", () => {
    useAhandStore.getState().setDeviceIdForUser("u1", "dev-1", true);
    useAhandStore.getState().setDeviceIdForUser("u2", "dev-2", true);
    useAhandStore.getState().clearUser("u1");
    expect(useAhandStore.getState().usersEnabled["u1"]).toBeUndefined();
    expect(useAhandStore.getState().usersEnabled["u2"]).toBeDefined();
  });

  it("clearUser on unknown userId is a no-op", () => {
    useAhandStore.getState().setDeviceIdForUser("u1", "dev-1", true);
    useAhandStore.getState().clearUser("nonexistent");
    expect(useAhandStore.getState().usersEnabled["u1"]).toBeDefined();
  });
});

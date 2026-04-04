import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the tauri module
const mockIsTauriApp = vi.hoisted(() => vi.fn());

vi.mock("../tauri", () => ({
  isTauriApp: mockIsTauriApp,
}));

import {
  registerServiceWorker,
  getServiceWorkerRegistration,
  sendHeartbeat,
} from "../push-notifications";

describe("push-notifications", () => {
  const mockRegistration = {
    scope: "/",
    active: {},
  } as unknown as ServiceWorkerRegistration;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsTauriApp.mockReturnValue(false);

    // Reset the module-level swRegistration by re-importing
    // We'll test indirectly through getServiceWorkerRegistration
  });

  describe("registerServiceWorker", () => {
    it("returns null when running in Tauri app", async () => {
      mockIsTauriApp.mockReturnValue(true);

      const result = await registerServiceWorker();

      expect(result).toBeNull();
    });

    it("returns null when serviceWorker is not supported", async () => {
      const originalServiceWorker =
        Object.getOwnPropertyDescriptor(navigator, "serviceWorker") ??
        Object.getOwnPropertyDescriptor(
          Object.getPrototypeOf(navigator),
          "serviceWorker",
        );

      Object.defineProperty(navigator, "serviceWorker", {
        value: undefined,
        configurable: true,
      });

      const result = await registerServiceWorker();

      expect(result).toBeNull();

      // Restore
      if (originalServiceWorker) {
        Object.defineProperty(
          navigator,
          "serviceWorker",
          originalServiceWorker,
        );
      }
    });

    it("returns null when PushManager is not supported", async () => {
      // Ensure serviceWorker exists but PushManager does not
      const originalPushManager = Object.getOwnPropertyDescriptor(
        window,
        "PushManager",
      );

      Object.defineProperty(navigator, "serviceWorker", {
        value: { register: vi.fn() },
        configurable: true,
      });

      // Remove PushManager
      const hasPushManager = "PushManager" in window;
      if (hasPushManager) {
        // @ts-expect-error - intentionally removing for test
        delete window.PushManager;
      }

      const result = await registerServiceWorker();

      expect(result).toBeNull();

      // Restore
      if (originalPushManager) {
        Object.defineProperty(window, "PushManager", originalPushManager);
      } else if (hasPushManager) {
        // @ts-expect-error - restoring
        window.PushManager = class {};
      }
    });

    it("registers service worker successfully", async () => {
      const mockRegister = vi.fn().mockResolvedValue(mockRegistration);

      Object.defineProperty(navigator, "serviceWorker", {
        value: { register: mockRegister },
        configurable: true,
      });
      Object.defineProperty(window, "PushManager", {
        value: class {},
        configurable: true,
      });

      const result = await registerServiceWorker();

      expect(result).toBe(mockRegistration);
      expect(mockRegister).toHaveBeenCalledWith("/sw.js", { scope: "/" });
      expect(getServiceWorkerRegistration()).toBe(mockRegistration);
    });

    it("returns null and logs error on registration failure", async () => {
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const mockRegister = vi
        .fn()
        .mockRejectedValue(new Error("Registration failed"));

      Object.defineProperty(navigator, "serviceWorker", {
        value: { register: mockRegister },
        configurable: true,
      });
      Object.defineProperty(window, "PushManager", {
        value: class {},
        configurable: true,
      });

      const result = await registerServiceWorker();

      expect(result).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Service Worker registration failed:",
        expect.any(Error),
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe("sendHeartbeat", () => {
    it("sends heartbeat message to service worker controller", () => {
      const mockPostMessage = vi.fn();

      Object.defineProperty(navigator, "serviceWorker", {
        value: { controller: { postMessage: mockPostMessage } },
        configurable: true,
      });

      sendHeartbeat("channel-123");

      expect(mockPostMessage).toHaveBeenCalledWith({
        type: "HEARTBEAT",
        channelId: "channel-123",
      });
    });

    it("sends heartbeat with null channelId", () => {
      const mockPostMessage = vi.fn();

      Object.defineProperty(navigator, "serviceWorker", {
        value: { controller: { postMessage: mockPostMessage } },
        configurable: true,
      });

      sendHeartbeat(null);

      expect(mockPostMessage).toHaveBeenCalledWith({
        type: "HEARTBEAT",
        channelId: null,
      });
    });

    it("does not throw when controller is not available", () => {
      Object.defineProperty(navigator, "serviceWorker", {
        value: { controller: null },
        configurable: true,
      });

      expect(() => sendHeartbeat("channel-123")).not.toThrow();
    });

    it("does not throw when serviceWorker is not available", () => {
      Object.defineProperty(navigator, "serviceWorker", {
        value: undefined,
        configurable: true,
      });

      expect(() => sendHeartbeat("channel-123")).not.toThrow();
    });
  });
});

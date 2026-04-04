import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// --- Hoisted mocks ---
const mockIsTauriApp = vi.hoisted(() => vi.fn());
const mockGetServiceWorkerRegistration = vi.hoisted(() => vi.fn());

const mockGetVapidPublicKey = vi.hoisted(() => vi.fn());
const mockSubscribeApi = vi.hoisted(() => vi.fn());
const mockUnsubscribeApi = vi.hoisted(() => vi.fn());

vi.mock("@/lib/tauri", () => ({
  isTauriApp: mockIsTauriApp,
}));

vi.mock("@/lib/push-notifications", () => ({
  getServiceWorkerRegistration: mockGetServiceWorkerRegistration,
}));

vi.mock("@/services/api/push-subscription", () => ({
  getVapidPublicKey: mockGetVapidPublicKey,
  subscribe: mockSubscribeApi,
  unsubscribe: mockUnsubscribeApi,
}));

import { usePushSubscription } from "../usePushSubscription";

// Helper to create mock PushSubscription
function createMockPushSubscription(endpoint: string) {
  return {
    endpoint,
    unsubscribe: vi.fn().mockResolvedValue(true),
    toJSON: () => ({
      endpoint,
      keys: { p256dh: "test-p256dh", auth: "test-auth" },
    }),
  };
}

// Helper to create mock ServiceWorkerRegistration
function createMockRegistration(
  subscription: ReturnType<typeof createMockPushSubscription> | null = null,
) {
  return {
    pushManager: {
      getSubscription: vi.fn().mockResolvedValue(subscription),
      subscribe: vi.fn(),
    },
  } as unknown as ServiceWorkerRegistration;
}

describe("usePushSubscription", () => {
  let originalNotification: typeof globalThis.Notification;
  let originalPushManager: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsTauriApp.mockReturnValue(false);
    mockGetServiceWorkerRegistration.mockReturnValue(null);

    // Save originals
    originalNotification = globalThis.Notification;
    originalPushManager = Object.getOwnPropertyDescriptor(
      window,
      "PushManager",
    );

    // Set up window globals for supported environment
    Object.defineProperty(window, "PushManager", {
      value: class {},
      configurable: true,
    });
    Object.defineProperty(window, "Notification", {
      value: Object.assign(vi.fn(), { permission: "default" }),
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    // Restore originals
    if (originalNotification) {
      Object.defineProperty(window, "Notification", {
        value: originalNotification,
        configurable: true,
        writable: true,
      });
    }
    if (originalPushManager) {
      Object.defineProperty(window, "PushManager", originalPushManager);
    } else {
      // @ts-expect-error - cleanup
      delete window.PushManager;
    }
  });

  describe("status checking", () => {
    it('reports "unsupported" in Tauri app', async () => {
      mockIsTauriApp.mockReturnValue(true);

      const { result } = renderHook(() => usePushSubscription());

      await waitFor(() => {
        expect(result.current.status).toBe("unsupported");
      });
    });

    it('reports "unsupported" when PushManager is not available', async () => {
      // @ts-expect-error - intentionally removing for test
      delete window.PushManager;

      const { result } = renderHook(() => usePushSubscription());

      await waitFor(() => {
        expect(result.current.status).toBe("unsupported");
      });
    });

    it('reports "unsupported" when Notification is not available', async () => {
      // @ts-expect-error - intentionally removing for test
      delete window.Notification;

      const { result } = renderHook(() => usePushSubscription());

      await waitFor(() => {
        expect(result.current.status).toBe("unsupported");
      });
    });

    it('reports "denied" when notification permission is denied', async () => {
      Object.defineProperty(window, "Notification", {
        value: Object.assign(vi.fn(), { permission: "denied" }),
        configurable: true,
        writable: true,
      });

      const { result } = renderHook(() => usePushSubscription());

      await waitFor(() => {
        expect(result.current.status).toBe("denied");
      });
    });

    it('reports "unsubscribed" when no service worker registration', async () => {
      mockGetServiceWorkerRegistration.mockReturnValue(null);

      const { result } = renderHook(() => usePushSubscription());

      await waitFor(() => {
        expect(result.current.status).toBe("unsubscribed");
      });
    });

    it('reports "unsubscribed" when registration has no subscription', async () => {
      const mockReg = createMockRegistration(null);
      mockGetServiceWorkerRegistration.mockReturnValue(mockReg);

      const { result } = renderHook(() => usePushSubscription());

      await waitFor(() => {
        expect(result.current.status).toBe("unsubscribed");
      });
    });

    it('reports "subscribed" when an active subscription exists', async () => {
      const mockSub = createMockPushSubscription(
        "https://fcm.googleapis.com/fcm/send/abc",
      );
      const mockReg = createMockRegistration(mockSub as never);
      mockGetServiceWorkerRegistration.mockReturnValue(mockReg);

      const { result } = renderHook(() => usePushSubscription());

      await waitFor(() => {
        expect(result.current.status).toBe("subscribed");
      });
    });
  });

  describe("subscribe flow", () => {
    it("subscribes successfully", async () => {
      const mockSub = createMockPushSubscription(
        "https://fcm.googleapis.com/fcm/send/abc",
      );
      const mockReg = createMockRegistration(null);
      (
        mockReg.pushManager.subscribe as ReturnType<typeof vi.fn>
      ).mockResolvedValue(mockSub);
      mockGetServiceWorkerRegistration.mockReturnValue(mockReg);

      Object.defineProperty(window, "Notification", {
        value: Object.assign(vi.fn(), {
          permission: "default",
          requestPermission: vi.fn().mockResolvedValue("granted"),
        }),
        configurable: true,
        writable: true,
      });

      mockGetVapidPublicKey.mockResolvedValue({
        publicKey: "BNhJk-test-vapid-key",
      });
      mockSubscribeApi.mockResolvedValue({ id: "sub-1" });

      const { result } = renderHook(() => usePushSubscription());

      await waitFor(() => {
        expect(result.current.status).not.toBe("loading");
      });

      let success: boolean | undefined;
      await act(async () => {
        success = await result.current.subscribe();
      });

      expect(success).toBe(true);
      expect(result.current.status).toBe("subscribed");
      expect(mockGetVapidPublicKey).toHaveBeenCalled();
      expect(mockReg.pushManager.subscribe).toHaveBeenCalledWith({
        userVisibleOnly: true,
        applicationServerKey: expect.any(Uint8Array),
      });
      expect(mockSubscribeApi).toHaveBeenCalledWith({
        endpoint: "https://fcm.googleapis.com/fcm/send/abc",
        keys: { p256dh: "test-p256dh", auth: "test-auth" },
      });
    });

    it("returns false when permission is denied", async () => {
      const mockReg = createMockRegistration(null);
      mockGetServiceWorkerRegistration.mockReturnValue(mockReg);

      Object.defineProperty(window, "Notification", {
        value: Object.assign(vi.fn(), {
          permission: "default",
          requestPermission: vi.fn().mockResolvedValue("denied"),
        }),
        configurable: true,
        writable: true,
      });

      const { result } = renderHook(() => usePushSubscription());

      await waitFor(() => {
        expect(result.current.status).not.toBe("loading");
      });

      let success: boolean | undefined;
      await act(async () => {
        success = await result.current.subscribe();
      });

      expect(success).toBe(false);
      expect(result.current.status).toBe("denied");
      expect(mockGetVapidPublicKey).not.toHaveBeenCalled();
    });

    it("returns false when no service worker registration", async () => {
      mockGetServiceWorkerRegistration.mockReturnValue(null);

      Object.defineProperty(window, "Notification", {
        value: Object.assign(vi.fn(), {
          permission: "default",
          requestPermission: vi.fn().mockResolvedValue("granted"),
        }),
        configurable: true,
        writable: true,
      });

      const { result } = renderHook(() => usePushSubscription());

      await waitFor(() => {
        expect(result.current.status).not.toBe("loading");
      });

      let success: boolean | undefined;
      await act(async () => {
        success = await result.current.subscribe();
      });

      expect(success).toBe(false);
    });

    it("returns false when VAPID public key is empty", async () => {
      const mockReg = createMockRegistration(null);
      mockGetServiceWorkerRegistration.mockReturnValue(mockReg);

      Object.defineProperty(window, "Notification", {
        value: Object.assign(vi.fn(), {
          permission: "default",
          requestPermission: vi.fn().mockResolvedValue("granted"),
        }),
        configurable: true,
        writable: true,
      });

      mockGetVapidPublicKey.mockResolvedValue({ publicKey: "" });

      const { result } = renderHook(() => usePushSubscription());

      await waitFor(() => {
        expect(result.current.status).not.toBe("loading");
      });

      let success: boolean | undefined;
      await act(async () => {
        success = await result.current.subscribe();
      });

      expect(success).toBe(false);
    });

    it("returns false and logs error on exception", async () => {
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const mockReg = createMockRegistration(null);
      mockGetServiceWorkerRegistration.mockReturnValue(mockReg);

      Object.defineProperty(window, "Notification", {
        value: Object.assign(vi.fn(), {
          permission: "default",
          requestPermission: vi
            .fn()
            .mockRejectedValue(new Error("Permission error")),
        }),
        configurable: true,
        writable: true,
      });

      const { result } = renderHook(() => usePushSubscription());

      await waitFor(() => {
        expect(result.current.status).not.toBe("loading");
      });

      let success: boolean | undefined;
      await act(async () => {
        success = await result.current.subscribe();
      });

      expect(success).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Push subscription failed:",
        expect.any(Error),
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe("unsubscribe flow", () => {
    it("unsubscribes successfully", async () => {
      const mockSub = createMockPushSubscription(
        "https://fcm.googleapis.com/fcm/send/abc",
      );
      const mockReg = createMockRegistration(mockSub as never);
      mockGetServiceWorkerRegistration.mockReturnValue(mockReg);
      mockUnsubscribeApi.mockResolvedValue({ success: true });

      const { result } = renderHook(() => usePushSubscription());

      await waitFor(() => {
        expect(result.current.status).toBe("subscribed");
      });

      let success: boolean | undefined;
      await act(async () => {
        success = await result.current.unsubscribe();
      });

      expect(success).toBe(true);
      expect(result.current.status).toBe("unsubscribed");
      expect(mockSub.unsubscribe).toHaveBeenCalled();
      expect(mockUnsubscribeApi).toHaveBeenCalledWith(
        "https://fcm.googleapis.com/fcm/send/abc",
      );
    });

    it("returns true when no existing subscription", async () => {
      const mockReg = createMockRegistration(null);
      mockGetServiceWorkerRegistration.mockReturnValue(mockReg);

      const { result } = renderHook(() => usePushSubscription());

      await waitFor(() => {
        expect(result.current.status).not.toBe("loading");
      });

      let success: boolean | undefined;
      await act(async () => {
        success = await result.current.unsubscribe();
      });

      expect(success).toBe(true);
      expect(result.current.status).toBe("unsubscribed");
      expect(mockUnsubscribeApi).not.toHaveBeenCalled();
    });

    it("returns false when no service worker registration", async () => {
      mockGetServiceWorkerRegistration.mockReturnValue(null);

      const { result } = renderHook(() => usePushSubscription());

      await waitFor(() => {
        expect(result.current.status).not.toBe("loading");
      });

      let success: boolean | undefined;
      await act(async () => {
        success = await result.current.unsubscribe();
      });

      expect(success).toBe(false);
    });

    it("returns false and logs error on exception", async () => {
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const mockSub = createMockPushSubscription(
        "https://fcm.googleapis.com/fcm/send/abc",
      );
      mockSub.unsubscribe.mockRejectedValue(new Error("Unsubscribe failed"));
      const mockReg = createMockRegistration(mockSub as never);
      mockGetServiceWorkerRegistration.mockReturnValue(mockReg);

      const { result } = renderHook(() => usePushSubscription());

      await waitFor(() => {
        expect(result.current.status).toBe("subscribed");
      });

      let success: boolean | undefined;
      await act(async () => {
        success = await result.current.unsubscribe();
      });

      expect(success).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Push unsubscribe failed:",
        expect.any(Error),
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe("checkStatus", () => {
    it("can be called manually to refresh status", async () => {
      mockGetServiceWorkerRegistration.mockReturnValue(null);

      const { result } = renderHook(() => usePushSubscription());

      await waitFor(() => {
        expect(result.current.status).toBe("unsubscribed");
      });

      // Now simulate that a subscription was created externally
      const mockSub = createMockPushSubscription(
        "https://fcm.googleapis.com/fcm/send/abc",
      );
      const mockReg = createMockRegistration(mockSub as never);
      mockGetServiceWorkerRegistration.mockReturnValue(mockReg);

      await act(async () => {
        await result.current.checkStatus();
      });

      expect(result.current.status).toBe("subscribed");
    });
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @/lib/tauri
const mockIsTauriApp = vi.fn<() => boolean>();
vi.mock("@/lib/tauri", () => ({
  isTauriApp: mockIsTauriApp,
}));

// Mock @tauri-apps/plugin-notification
const mockIsPermissionGranted = vi.fn<() => Promise<boolean>>();
const mockRequestPermission = vi.fn<() => Promise<string>>();
const mockSendNotification = vi.fn();

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: mockIsPermissionGranted,
  requestPermission: mockRequestPermission,
  sendNotification: mockSendNotification,
}));

// Flush both microtasks and a macrotask so chained awaits (including dynamic
// import resolution) across several concurrent async callers all reach their
// next suspend point.
async function flushAsync(n = 30) {
  for (let i = 0; i < n; i++) {
    await Promise.resolve();
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (let i = 0; i < n; i++) {
    await Promise.resolve();
  }
}

// We need to re-import the module fresh for each test to reset the cached
// notificationModule. Use dynamic import + resetModules.
async function loadModule() {
  const mod = await import("../tauri-notification");
  return mod;
}

describe("tauri-notification", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockIsTauriApp.mockReturnValue(false);
    mockIsPermissionGranted.mockResolvedValue(false);
    mockRequestPermission.mockResolvedValue("denied");
  });

  describe("isTauriNotificationGranted", () => {
    it("returns false when not running in Tauri", async () => {
      mockIsTauriApp.mockReturnValue(false);
      const { isTauriNotificationGranted } = await loadModule();

      const result = await isTauriNotificationGranted();

      expect(result).toBe(false);
      expect(mockIsPermissionGranted).not.toHaveBeenCalled();
    });

    it("returns true when OS permission is granted", async () => {
      mockIsTauriApp.mockReturnValue(true);
      mockIsPermissionGranted.mockResolvedValue(true);
      const { isTauriNotificationGranted } = await loadModule();

      const result = await isTauriNotificationGranted();

      expect(result).toBe(true);
    });

    it("returns false when OS permission is not granted", async () => {
      mockIsTauriApp.mockReturnValue(true);
      mockIsPermissionGranted.mockResolvedValue(false);
      const { isTauriNotificationGranted } = await loadModule();

      const result = await isTauriNotificationGranted();

      expect(result).toBe(false);
      // Should not trigger a permission request — query is side-effect free.
      expect(mockRequestPermission).not.toHaveBeenCalled();
    });
  });

  describe("requestTauriNotificationPermission", () => {
    it('returns "default" when not running in Tauri', async () => {
      mockIsTauriApp.mockReturnValue(false);
      const { requestTauriNotificationPermission } = await loadModule();

      const result = await requestTauriNotificationPermission();

      expect(result).toBe("default");
      expect(mockIsPermissionGranted).not.toHaveBeenCalled();
    });

    it('returns "granted" without prompting when already granted', async () => {
      mockIsTauriApp.mockReturnValue(true);
      mockIsPermissionGranted.mockResolvedValue(true);
      const { requestTauriNotificationPermission } = await loadModule();

      const result = await requestTauriNotificationPermission();

      expect(result).toBe("granted");
      expect(mockRequestPermission).not.toHaveBeenCalled();
    });

    it('returns "granted" after prompting when user allows', async () => {
      mockIsTauriApp.mockReturnValue(true);
      mockIsPermissionGranted.mockResolvedValue(false);
      mockRequestPermission.mockResolvedValue("granted");
      const { requestTauriNotificationPermission } = await loadModule();

      const result = await requestTauriNotificationPermission();

      expect(result).toBe("granted");
      expect(mockRequestPermission).toHaveBeenCalledOnce();
    });

    it('returns "denied" after prompting when user denies', async () => {
      mockIsTauriApp.mockReturnValue(true);
      mockIsPermissionGranted.mockResolvedValue(false);
      mockRequestPermission.mockResolvedValue("denied");
      const { requestTauriNotificationPermission } = await loadModule();

      const result = await requestTauriNotificationPermission();

      expect(result).toBe("denied");
      expect(mockRequestPermission).toHaveBeenCalledOnce();
    });

    it('returns "default" when user dismisses the prompt', async () => {
      mockIsTauriApp.mockReturnValue(true);
      mockIsPermissionGranted.mockResolvedValue(false);
      mockRequestPermission.mockResolvedValue("default");
      const { requestTauriNotificationPermission } = await loadModule();

      const result = await requestTauriNotificationPermission();

      expect(result).toBe("default");
      expect(mockRequestPermission).toHaveBeenCalledOnce();
    });

    it("caches the notification module across calls", async () => {
      mockIsTauriApp.mockReturnValue(true);
      mockIsPermissionGranted.mockResolvedValue(true);
      const { requestTauriNotificationPermission } = await loadModule();

      await requestTauriNotificationPermission();
      await requestTauriNotificationPermission();

      // isPermissionGranted should be called twice (once per call)
      expect(mockIsPermissionGranted).toHaveBeenCalledTimes(2);
    });
  });

  describe("showTauriNotification", () => {
    it("does nothing when not running in Tauri", async () => {
      mockIsTauriApp.mockReturnValue(false);
      const { showTauriNotification } = await loadModule();

      await showTauriNotification({ title: "Test" });

      expect(mockSendNotification).not.toHaveBeenCalled();
      expect(mockRequestPermission).not.toHaveBeenCalled();
    });

    it("sends notification when permission is already granted", async () => {
      mockIsTauriApp.mockReturnValue(true);
      mockIsPermissionGranted.mockResolvedValue(true);
      const { showTauriNotification } = await loadModule();

      await showTauriNotification({ title: "Hello" });

      expect(mockSendNotification).toHaveBeenCalledWith({
        title: "Hello",
        body: undefined,
      });
      // No prompt needed when already granted.
      expect(mockRequestPermission).not.toHaveBeenCalled();
    });

    it("sends notification with title and body when permission is granted", async () => {
      mockIsTauriApp.mockReturnValue(true);
      mockIsPermissionGranted.mockResolvedValue(true);
      const { showTauriNotification } = await loadModule();

      await showTauriNotification({
        title: "New Message",
        body: "You have a new message from Alice",
      });

      expect(mockSendNotification).toHaveBeenCalledWith({
        title: "New Message",
        body: "You have a new message from Alice",
      });
    });

    it("requests permission and sends when user grants on first notification", async () => {
      mockIsTauriApp.mockReturnValue(true);
      mockIsPermissionGranted.mockResolvedValue(false);
      mockRequestPermission.mockResolvedValue("granted");
      const { showTauriNotification } = await loadModule();

      await showTauriNotification({ title: "First", body: "Hello" });

      expect(mockRequestPermission).toHaveBeenCalledOnce();
      expect(mockSendNotification).toHaveBeenCalledWith({
        title: "First",
        body: "Hello",
      });
    });

    it("requests permission and does not send when user denies", async () => {
      mockIsTauriApp.mockReturnValue(true);
      mockIsPermissionGranted.mockResolvedValue(false);
      mockRequestPermission.mockResolvedValue("denied");
      const { showTauriNotification } = await loadModule();

      await showTauriNotification({ title: "Test" });

      expect(mockRequestPermission).toHaveBeenCalledOnce();
      expect(mockSendNotification).not.toHaveBeenCalled();
    });

    it('does not send when requestPermission returns "default" (user dismissed)', async () => {
      mockIsTauriApp.mockReturnValue(true);
      mockIsPermissionGranted.mockResolvedValue(false);
      mockRequestPermission.mockResolvedValue("default");
      const { showTauriNotification } = await loadModule();

      await showTauriNotification({ title: "Test" });

      expect(mockRequestPermission).toHaveBeenCalledOnce();
      expect(mockSendNotification).not.toHaveBeenCalled();
    });

    it("coalesces concurrent requests from showTauriNotification into one OS prompt", async () => {
      // A burst of 5 messages arrives while permission is still "default".
      // requestPermission must be called at most once — otherwise the OS may
      // show duplicate dialogs or silently drop notifications.
      mockIsTauriApp.mockReturnValue(true);
      mockIsPermissionGranted.mockResolvedValue(false);
      mockRequestPermission.mockResolvedValue("granted");

      const { showTauriNotification } = await loadModule();

      await Promise.all([
        showTauriNotification({ title: "A" }),
        showTauriNotification({ title: "B" }),
        showTauriNotification({ title: "C" }),
        showTauriNotification({ title: "D" }),
        showTauriNotification({ title: "E" }),
      ]);

      // Only one OS prompt regardless of burst size.
      expect(mockRequestPermission).toHaveBeenCalledTimes(1);
      // Each caller independently checks isPermissionGranted.
      expect(mockIsPermissionGranted).toHaveBeenCalledTimes(5);
    });

    it("coalesces concurrent callers of requestTauriNotificationPermission", async () => {
      // The settings dialog toggle + another caller (e.g. first message) must
      // not race into duplicate OS prompts.
      mockIsTauriApp.mockReturnValue(true);
      mockIsPermissionGranted.mockResolvedValue(false);
      let resolveRequest: (v: string) => void = () => {};
      mockRequestPermission.mockImplementation(
        () =>
          new Promise<string>((resolve) => {
            resolveRequest = resolve;
          }),
      );

      const { requestTauriNotificationPermission } = await loadModule();

      const a = requestTauriNotificationPermission();
      const b = requestTauriNotificationPermission();
      const c = requestTauriNotificationPermission();

      await flushAsync();
      expect(mockRequestPermission).toHaveBeenCalledTimes(1);

      resolveRequest("granted");
      const results = await Promise.all([a, b, c]);

      expect(results).toEqual(["granted", "granted", "granted"]);
      expect(mockRequestPermission).toHaveBeenCalledTimes(1);
    });

    it("allows a fresh permission request after the previous one resolves", async () => {
      // The singleton must release after the request resolves so that a later
      // (separate) event can re-trigger a prompt if the user is still in
      // "default" state (e.g., dismissed the first dialog).
      mockIsTauriApp.mockReturnValue(true);
      mockIsPermissionGranted.mockResolvedValue(false);
      mockRequestPermission.mockResolvedValue("default");

      const { showTauriNotification } = await loadModule();

      await showTauriNotification({ title: "A" });
      await showTauriNotification({ title: "B" });

      expect(mockRequestPermission).toHaveBeenCalledTimes(2);
      expect(mockSendNotification).not.toHaveBeenCalled();
    });
  });

  describe("plugin failure handling", () => {
    it("degrades gracefully when a plugin method rejects", async () => {
      // Simulates an IPC / native-layer failure — e.g. after OS sleep-resume
      // the Tauri plugin's underlying command throws. All three public APIs
      // must degrade to safe defaults instead of propagating the rejection.
      mockIsTauriApp.mockReturnValue(true);
      mockIsPermissionGranted.mockRejectedValue(new Error("IPC failed"));
      mockRequestPermission.mockRejectedValue(new Error("IPC failed"));

      const mod = await loadModule();

      await expect(
        mod.showTauriNotification({ title: "X" }),
      ).resolves.toBeUndefined();
      await expect(mod.isTauriNotificationGranted()).resolves.toBe(false);
      await expect(mod.requestTauriNotificationPermission()).resolves.toBe(
        "default",
      );

      // sendNotification must not be called when the permission check fails.
      expect(mockSendNotification).not.toHaveBeenCalled();
    });
  });
});

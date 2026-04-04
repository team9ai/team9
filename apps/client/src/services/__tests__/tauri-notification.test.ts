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

  describe("requestTauriNotificationPermission", () => {
    it("returns false when not running in Tauri", async () => {
      mockIsTauriApp.mockReturnValue(false);
      const { requestTauriNotificationPermission } = await loadModule();

      const result = await requestTauriNotificationPermission();

      expect(result).toBe(false);
      expect(mockIsPermissionGranted).not.toHaveBeenCalled();
    });

    it("returns true when permission is already granted", async () => {
      mockIsTauriApp.mockReturnValue(true);
      mockIsPermissionGranted.mockResolvedValue(true);
      const { requestTauriNotificationPermission } = await loadModule();

      const result = await requestTauriNotificationPermission();

      expect(result).toBe(true);
      expect(mockRequestPermission).not.toHaveBeenCalled();
    });

    it("requests permission and returns true when granted", async () => {
      mockIsTauriApp.mockReturnValue(true);
      mockIsPermissionGranted.mockResolvedValue(false);
      mockRequestPermission.mockResolvedValue("granted");
      const { requestTauriNotificationPermission } = await loadModule();

      const result = await requestTauriNotificationPermission();

      expect(result).toBe(true);
      expect(mockRequestPermission).toHaveBeenCalledOnce();
    });

    it("requests permission and returns false when denied", async () => {
      mockIsTauriApp.mockReturnValue(true);
      mockIsPermissionGranted.mockResolvedValue(false);
      mockRequestPermission.mockResolvedValue("denied");
      const { requestTauriNotificationPermission } = await loadModule();

      const result = await requestTauriNotificationPermission();

      expect(result).toBe(false);
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
    });

    it("does nothing when permission is not granted", async () => {
      mockIsTauriApp.mockReturnValue(true);
      mockIsPermissionGranted.mockResolvedValue(false);
      const { showTauriNotification } = await loadModule();

      await showTauriNotification({ title: "Test" });

      expect(mockSendNotification).not.toHaveBeenCalled();
    });

    it("sends notification with title only", async () => {
      mockIsTauriApp.mockReturnValue(true);
      mockIsPermissionGranted.mockResolvedValue(true);
      const { showTauriNotification } = await loadModule();

      await showTauriNotification({ title: "Hello" });

      expect(mockSendNotification).toHaveBeenCalledWith({
        title: "Hello",
        body: undefined,
      });
    });

    it("sends notification with title and body", async () => {
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
  });
});

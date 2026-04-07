import { beforeEach, describe, expect, it } from "vitest";
import {
  getLocalNotificationPrefs,
  setFocusSuppression,
  setDesktopEnabledLocal,
  isViewingCurrentChannel,
} from "../notification-prefs-local";

describe("notification-prefs-local", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("getLocalNotificationPrefs", () => {
    it("returns defaults when no values are stored", () => {
      const prefs = getLocalNotificationPrefs();

      expect(prefs).toEqual({
        focusSuppression: true,
        desktopEnabledLocal: true,
      });
    });

    it("returns focusSuppression=true when stored as 'true'", () => {
      localStorage.setItem("notification_focus_suppression", "true");

      const prefs = getLocalNotificationPrefs();

      expect(prefs.focusSuppression).toBe(true);
    });

    it("returns focusSuppression=false when stored as 'false'", () => {
      localStorage.setItem("notification_focus_suppression", "false");

      const prefs = getLocalNotificationPrefs();

      expect(prefs.focusSuppression).toBe(false);
    });

    it("returns desktopEnabledLocal=true when stored as 'true'", () => {
      localStorage.setItem("notification_desktop_enabled_local", "true");

      const prefs = getLocalNotificationPrefs();

      expect(prefs.desktopEnabledLocal).toBe(true);
    });

    it("returns desktopEnabledLocal=false when stored as 'false'", () => {
      localStorage.setItem("notification_desktop_enabled_local", "false");

      const prefs = getLocalNotificationPrefs();

      expect(prefs.desktopEnabledLocal).toBe(false);
    });

    it("treats any non-'false' value as true", () => {
      localStorage.setItem("notification_focus_suppression", "yes");
      localStorage.setItem("notification_desktop_enabled_local", "1");

      const prefs = getLocalNotificationPrefs();

      expect(prefs.focusSuppression).toBe(true);
      expect(prefs.desktopEnabledLocal).toBe(true);
    });
  });

  describe("setFocusSuppression", () => {
    it("stores true as string", () => {
      setFocusSuppression(true);

      expect(localStorage.getItem("notification_focus_suppression")).toBe(
        "true",
      );
    });

    it("stores false as string", () => {
      setFocusSuppression(false);

      expect(localStorage.getItem("notification_focus_suppression")).toBe(
        "false",
      );
    });

    it("is reflected by getLocalNotificationPrefs", () => {
      setFocusSuppression(false);

      expect(getLocalNotificationPrefs().focusSuppression).toBe(false);

      setFocusSuppression(true);

      expect(getLocalNotificationPrefs().focusSuppression).toBe(true);
    });
  });

  describe("setDesktopEnabledLocal", () => {
    it("stores true as string", () => {
      setDesktopEnabledLocal(true);

      expect(localStorage.getItem("notification_desktop_enabled_local")).toBe(
        "true",
      );
    });

    it("stores false as string", () => {
      setDesktopEnabledLocal(false);

      expect(localStorage.getItem("notification_desktop_enabled_local")).toBe(
        "false",
      );
    });

    it("is reflected by getLocalNotificationPrefs", () => {
      setDesktopEnabledLocal(false);

      expect(getLocalNotificationPrefs().desktopEnabledLocal).toBe(false);

      setDesktopEnabledLocal(true);

      expect(getLocalNotificationPrefs().desktopEnabledLocal).toBe(true);
    });
  });

  describe("isViewingCurrentChannel", () => {
    it("returns false for null channelId", () => {
      expect(isViewingCurrentChannel(null)).toBe(false);
    });

    it("returns false for undefined channelId", () => {
      expect(isViewingCurrentChannel(undefined)).toBe(false);
    });

    it("returns false for empty string channelId", () => {
      expect(isViewingCurrentChannel("")).toBe(false);
    });

    it("returns false when document is not visible", () => {
      Object.defineProperty(document, "visibilityState", {
        value: "hidden",
        configurable: true,
      });

      // Set a matching pathname
      Object.defineProperty(window, "location", {
        value: { pathname: "/channels/ch-123" },
        configurable: true,
        writable: true,
      });

      expect(isViewingCurrentChannel("ch-123")).toBe(false);

      // Restore
      Object.defineProperty(document, "visibilityState", {
        value: "visible",
        configurable: true,
      });
    });

    it("returns true when viewing /channels/{channelId}", () => {
      Object.defineProperty(document, "visibilityState", {
        value: "visible",
        configurable: true,
      });
      Object.defineProperty(window, "location", {
        value: { pathname: "/channels/ch-123" },
        configurable: true,
        writable: true,
      });

      expect(isViewingCurrentChannel("ch-123")).toBe(true);
    });

    it("returns true when viewing /messages/{channelId}", () => {
      Object.defineProperty(document, "visibilityState", {
        value: "visible",
        configurable: true,
      });
      Object.defineProperty(window, "location", {
        value: { pathname: "/messages/ch-123" },
        configurable: true,
        writable: true,
      });

      expect(isViewingCurrentChannel("ch-123")).toBe(true);
    });

    it("returns true when viewing /activity/channel/{channelId}", () => {
      Object.defineProperty(document, "visibilityState", {
        value: "visible",
        configurable: true,
      });
      Object.defineProperty(window, "location", {
        value: { pathname: "/activity/channel/ch-123" },
        configurable: true,
        writable: true,
      });

      expect(isViewingCurrentChannel("ch-123")).toBe(true);
    });

    it("returns false when viewing a different channel", () => {
      Object.defineProperty(document, "visibilityState", {
        value: "visible",
        configurable: true,
      });
      Object.defineProperty(window, "location", {
        value: { pathname: "/channels/ch-other" },
        configurable: true,
        writable: true,
      });

      expect(isViewingCurrentChannel("ch-123")).toBe(false);
    });

    it("returns false when on a non-channel page", () => {
      Object.defineProperty(document, "visibilityState", {
        value: "visible",
        configurable: true,
      });
      Object.defineProperty(window, "location", {
        value: { pathname: "/settings/profile" },
        configurable: true,
        writable: true,
      });

      expect(isViewingCurrentChannel("ch-123")).toBe(false);
    });
  });
});

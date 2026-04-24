import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// --- Hoisted mocks ---
const mockUpdatePreferences = vi.hoisted(() => vi.fn());
const mockSubscribe = vi.hoisted(() => vi.fn());
const mockUnsubscribe = vi.hoisted(() => vi.fn());
const mockIsTauriApp = vi.hoisted(() => vi.fn(() => false));
const mockRequestTauriPermission = vi.hoisted(() =>
  vi.fn<() => Promise<"granted" | "denied" | "default">>(),
);
const mockIsTauriNotificationGranted = vi.hoisted(() =>
  vi.fn<() => Promise<boolean>>(),
);

const mockPreferencesData = vi.hoisted(() => ({
  current: {
    mentionsEnabled: true,
    repliesEnabled: true,
    dmsEnabled: true,
    systemEnabled: true,
    workspaceEnabled: true,
    desktopEnabled: false,
    soundEnabled: true,
    dndEnabled: false,
    dndStart: null as string | null,
    dndEnd: null as string | null,
  },
}));

const mockIsLoading = vi.hoisted(() => ({ current: false }));
const mockPushStatus = vi.hoisted(() => ({
  current: "unsubscribed" as string,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@/hooks/useNotificationPreferences", () => ({
  useNotificationPreferences: () => ({
    preferences: mockIsLoading.current
      ? undefined
      : mockPreferencesData.current,
    isLoading: mockIsLoading.current,
    updatePreferences: mockUpdatePreferences,
    isUpdating: false,
  }),
}));

vi.mock("@/hooks/usePushSubscription", () => ({
  usePushSubscription: () => ({
    status: mockPushStatus.current,
    subscribe: mockSubscribe,
    unsubscribe: mockUnsubscribe,
    checkStatus: vi.fn(),
  }),
}));

vi.mock("@/lib/tauri", () => ({
  isTauriApp: mockIsTauriApp,
}));

vi.mock("@/services/tauri-notification", () => ({
  isTauriNotificationGranted: mockIsTauriNotificationGranted,
  requestTauriNotificationPermission: mockRequestTauriPermission,
}));

import { NotificationPreferencesDialog } from "../NotificationPreferencesDialog";

describe("NotificationPreferencesDialog", () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdatePreferences.mockResolvedValue(undefined);
    mockSubscribe.mockResolvedValue(true);
    mockUnsubscribe.mockResolvedValue(true);
    mockIsTauriApp.mockReturnValue(false);
    mockIsTauriNotificationGranted.mockResolvedValue(false);
    mockRequestTauriPermission.mockResolvedValue("granted");
    mockIsLoading.current = false;
    mockPushStatus.current = "unsubscribed";
    mockPreferencesData.current = {
      mentionsEnabled: true,
      repliesEnabled: true,
      dmsEnabled: true,
      systemEnabled: true,
      workspaceEnabled: true,
      desktopEnabled: false,
      soundEnabled: true,
      dndEnabled: false,
      dndStart: null,
      dndEnd: null,
    };
    localStorage.clear();
  });

  it("renders the dialog title", () => {
    render(<NotificationPreferencesDialog {...defaultProps} />);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "notificationPreferences" }),
    ).toBeInTheDocument();
  });

  it("does not render when closed", () => {
    render(<NotificationPreferencesDialog {...defaultProps} open={false} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows loading spinner when preferences are loading", () => {
    mockIsLoading.current = true;

    render(<NotificationPreferencesDialog {...defaultProps} />);

    // The title should still be visible
    expect(
      screen.getByRole("heading", { name: "notificationPreferences" }),
    ).toBeInTheDocument();
    // But toggle switches should not be present
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  describe("desktop notifications section", () => {
    it("renders desktop notifications toggle", () => {
      render(<NotificationPreferencesDialog {...defaultProps} />);

      expect(screen.getByText("desktopNotifications")).toBeInTheDocument();
    });

    it("toggles desktop enabled: subscribes first, then updates preferences", async () => {
      render(<NotificationPreferencesDialog {...defaultProps} />);

      const switches = screen.getAllByRole("switch");
      // First switch is desktopEnabled
      const desktopSwitch = switches[0];
      fireEvent.click(desktopSwitch);

      await waitFor(() => {
        expect(mockSubscribe).toHaveBeenCalled();
        expect(mockUpdatePreferences).toHaveBeenCalledWith({
          desktopEnabled: true,
        });
      });
    });

    it("does not update preferences when subscribe fails", async () => {
      mockSubscribe.mockResolvedValue(false);

      render(<NotificationPreferencesDialog {...defaultProps} />);

      const switches = screen.getAllByRole("switch");
      const desktopSwitch = switches[0];
      fireEvent.click(desktopSwitch);

      await waitFor(() => {
        expect(mockSubscribe).toHaveBeenCalled();
      });

      // updatePreferences should NOT have been called because subscribe returned false
      expect(mockUpdatePreferences).not.toHaveBeenCalled();
    });

    it("toggles desktop off: unsubscribes first, then updates preferences", async () => {
      mockPreferencesData.current.desktopEnabled = true;
      mockPushStatus.current = "subscribed";

      render(<NotificationPreferencesDialog {...defaultProps} />);

      const switches = screen.getAllByRole("switch");
      const desktopSwitch = switches[0];
      fireEvent.click(desktopSwitch);

      await waitFor(() => {
        expect(mockUnsubscribe).toHaveBeenCalled();
        expect(mockUpdatePreferences).toHaveBeenCalledWith({
          desktopEnabled: false,
        });
      });
    });

    it("shows push status text for denied", () => {
      mockPushStatus.current = "denied";

      render(<NotificationPreferencesDialog {...defaultProps} />);

      expect(screen.getByText("pushPermissionDenied")).toBeInTheDocument();
    });

    it("disables switch when push status is denied", () => {
      mockPushStatus.current = "denied";

      render(<NotificationPreferencesDialog {...defaultProps} />);

      const switches = screen.getAllByRole("switch");
      expect(switches[0]).toBeDisabled();
    });

    it("shows push status text for unsupported", () => {
      mockPushStatus.current = "unsupported";

      render(<NotificationPreferencesDialog {...defaultProps} />);

      expect(screen.getByText("pushUnsupported")).toBeInTheDocument();
    });

    it("disables switch when push status is unsupported", () => {
      mockPushStatus.current = "unsupported";

      render(<NotificationPreferencesDialog {...defaultProps} />);

      const switches = screen.getAllByRole("switch");
      expect(switches[0]).toBeDisabled();
    });

    it("shows prompt text when status is unsubscribed", () => {
      mockPushStatus.current = "unsubscribed";

      render(<NotificationPreferencesDialog {...defaultProps} />);

      expect(screen.getByText("pushPermissionPrompt")).toBeInTheDocument();
    });

    it("shows prompt text when status is prompt", () => {
      mockPushStatus.current = "prompt";

      render(<NotificationPreferencesDialog {...defaultProps} />);

      expect(screen.getByText("pushPermissionPrompt")).toBeInTheDocument();
    });

    it("shows enabled text when subscribed", () => {
      mockPushStatus.current = "subscribed";

      render(<NotificationPreferencesDialog {...defaultProps} />);

      expect(screen.getByText("pushEnabled")).toBeInTheDocument();
    });
  });

  describe("focus suppression section", () => {
    it("renders focus suppression toggle", () => {
      render(<NotificationPreferencesDialog {...defaultProps} />);

      expect(screen.getByText("muteWhenViewing")).toBeInTheDocument();
    });

    it("persists focus suppression to localStorage", () => {
      render(<NotificationPreferencesDialog {...defaultProps} />);

      // Focus suppression is the second switch
      const switches = screen.getAllByRole("switch");
      const focusSwitch = switches[1];

      // Default is true (checked), click to set false
      fireEvent.click(focusSwitch);

      expect(localStorage.getItem("notification_focus_suppression")).toBe(
        "false",
      );
    });

    it("reads focus suppression from localStorage", () => {
      localStorage.setItem("notification_focus_suppression", "false");

      render(<NotificationPreferencesDialog {...defaultProps} />);

      const switches = screen.getAllByRole("switch");
      const focusSwitch = switches[1];
      // Should be unchecked
      expect(focusSwitch).toHaveAttribute("data-state", "unchecked");
    });
  });

  describe("notification types section", () => {
    it("renders all notification type toggles", () => {
      render(<NotificationPreferencesDialog {...defaultProps} />);

      expect(screen.getByText("notificationTypes")).toBeInTheDocument();
      expect(screen.getByText("mentions")).toBeInTheDocument();
      expect(screen.getByText("replies")).toBeInTheDocument();
      expect(screen.getByText("directMessages")).toBeInTheDocument();
      expect(screen.getByText("systemNotifications")).toBeInTheDocument();
      expect(screen.getByText("workspaceNotifications")).toBeInTheDocument();
    });

    it("toggles mentions preference", async () => {
      render(<NotificationPreferencesDialog {...defaultProps} />);

      const switches = screen.getAllByRole("switch");
      // Switches order: desktop, focus, mentions, replies, dms, system, workspace, sound, dnd
      const mentionsSwitch = switches[2];
      fireEvent.click(mentionsSwitch);

      await waitFor(() => {
        expect(mockUpdatePreferences).toHaveBeenCalledWith({
          mentionsEnabled: false,
        });
      });
    });

    it("toggles replies preference", async () => {
      render(<NotificationPreferencesDialog {...defaultProps} />);

      const switches = screen.getAllByRole("switch");
      const repliesSwitch = switches[3];
      fireEvent.click(repliesSwitch);

      await waitFor(() => {
        expect(mockUpdatePreferences).toHaveBeenCalledWith({
          repliesEnabled: false,
        });
      });
    });

    it("toggles DMs preference", async () => {
      render(<NotificationPreferencesDialog {...defaultProps} />);

      const switches = screen.getAllByRole("switch");
      const dmsSwitch = switches[4];
      fireEvent.click(dmsSwitch);

      await waitFor(() => {
        expect(mockUpdatePreferences).toHaveBeenCalledWith({
          dmsEnabled: false,
        });
      });
    });

    it("toggles system preference", async () => {
      render(<NotificationPreferencesDialog {...defaultProps} />);

      const switches = screen.getAllByRole("switch");
      const systemSwitch = switches[5];
      fireEvent.click(systemSwitch);

      await waitFor(() => {
        expect(mockUpdatePreferences).toHaveBeenCalledWith({
          systemEnabled: false,
        });
      });
    });

    it("toggles workspace preference", async () => {
      render(<NotificationPreferencesDialog {...defaultProps} />);

      const switches = screen.getAllByRole("switch");
      const workspaceSwitch = switches[6];
      fireEvent.click(workspaceSwitch);

      await waitFor(() => {
        expect(mockUpdatePreferences).toHaveBeenCalledWith({
          workspaceEnabled: false,
        });
      });
    });
  });

  describe("sound section", () => {
    it("renders sound toggle", () => {
      render(<NotificationPreferencesDialog {...defaultProps} />);

      expect(screen.getByText("sound")).toBeInTheDocument();
    });

    it("toggles sound preference", async () => {
      render(<NotificationPreferencesDialog {...defaultProps} />);

      const switches = screen.getAllByRole("switch");
      const soundSwitch = switches[7];
      fireEvent.click(soundSwitch);

      await waitFor(() => {
        expect(mockUpdatePreferences).toHaveBeenCalledWith({
          soundEnabled: false,
        });
      });
    });
  });

  describe("do not disturb section", () => {
    it("renders DND toggle", () => {
      render(<NotificationPreferencesDialog {...defaultProps} />);

      expect(screen.getByText("doNotDisturb")).toBeInTheDocument();
    });

    it("does not show time pickers when DND is disabled", () => {
      render(<NotificationPreferencesDialog {...defaultProps} />);

      expect(screen.queryByText("dndStartTime")).not.toBeInTheDocument();
      expect(screen.queryByText("dndEndTime")).not.toBeInTheDocument();
    });

    it("shows time pickers when DND is enabled", () => {
      mockPreferencesData.current.dndEnabled = true;
      mockPreferencesData.current.dndStart = "1970-01-01T22:00:00.000Z";
      mockPreferencesData.current.dndEnd = "1970-01-01T07:00:00.000Z";

      render(<NotificationPreferencesDialog {...defaultProps} />);

      expect(screen.getByText("dndStartTime")).toBeInTheDocument();
      expect(screen.getByText("dndEndTime")).toBeInTheDocument();
    });

    it("toggles DND preference", async () => {
      render(<NotificationPreferencesDialog {...defaultProps} />);

      const switches = screen.getAllByRole("switch");
      // DND is the last switch
      const dndSwitch = switches[8];
      fireEvent.click(dndSwitch);

      await waitFor(() => {
        expect(mockUpdatePreferences).toHaveBeenCalledWith({
          dndEnabled: true,
        });
      });
    });

    it("updates DND start time", async () => {
      mockPreferencesData.current.dndEnabled = true;

      render(<NotificationPreferencesDialog {...defaultProps} />);

      const timeInputs = screen.getAllByDisplayValue("");
      // First time input is dndStart
      fireEvent.change(timeInputs[0], { target: { value: "22:00" } });

      await waitFor(() => {
        expect(mockUpdatePreferences).toHaveBeenCalledWith({
          dndStart: "1970-01-01T22:00:00.000Z",
        });
      });
    });

    it("updates DND end time", async () => {
      mockPreferencesData.current.dndEnabled = true;

      render(<NotificationPreferencesDialog {...defaultProps} />);

      const timeInputs = screen.getAllByDisplayValue("");
      // Second time input is dndEnd
      fireEvent.change(timeInputs[1], { target: { value: "07:00" } });

      await waitFor(() => {
        expect(mockUpdatePreferences).toHaveBeenCalledWith({
          dndEnd: "1970-01-01T07:00:00.000Z",
        });
      });
    });

    it("sends null when clearing DND time", async () => {
      mockPreferencesData.current.dndEnabled = true;
      mockPreferencesData.current.dndStart = "1970-01-01T22:00:00.000Z";

      render(<NotificationPreferencesDialog {...defaultProps} />);

      const timeInputs = screen.getAllByDisplayValue("22:00");
      fireEvent.change(timeInputs[0], { target: { value: "" } });

      await waitFor(() => {
        expect(mockUpdatePreferences).toHaveBeenCalledWith({
          dndStart: null,
        });
      });
    });
  });

  describe("non-desktop toggles do not call subscribe/unsubscribe", () => {
    it("toggling sound does not call subscribe or unsubscribe", async () => {
      render(<NotificationPreferencesDialog {...defaultProps} />);

      const switches = screen.getAllByRole("switch");
      const soundSwitch = switches[7];
      fireEvent.click(soundSwitch);

      await waitFor(() => {
        expect(mockUpdatePreferences).toHaveBeenCalled();
      });

      expect(mockSubscribe).not.toHaveBeenCalled();
      expect(mockUnsubscribe).not.toHaveBeenCalled();
    });
  });

  describe("desktop notifications in Tauri (per-device)", () => {
    beforeEach(() => {
      mockIsTauriApp.mockReturnValue(true);
      // pushStatus is "unsupported" in Tauri per usePushSubscription.
      mockPushStatus.current = "unsupported";
    });

    it("defaults the switch to checked via local prefs (desktopEnabledLocal=true)", () => {
      render(<NotificationPreferencesDialog {...defaultProps} />);

      const switches = screen.getAllByRole("switch");
      expect(switches[0]).toHaveAttribute("data-state", "checked");
    });

    it("reads desktopEnabledLocal=false from localStorage", () => {
      localStorage.setItem("notification_desktop_enabled_local", "false");

      render(<NotificationPreferencesDialog {...defaultProps} />);

      const switches = screen.getAllByRole("switch");
      expect(switches[0]).toHaveAttribute("data-state", "unchecked");
    });

    it("does not disable the switch on pushStatus=unsupported in Tauri", () => {
      render(<NotificationPreferencesDialog {...defaultProps} />);

      const switches = screen.getAllByRole("switch");
      expect(switches[0]).not.toBeDisabled();
    });

    it("shows granted status text when OS permission is granted on mount", async () => {
      mockIsTauriNotificationGranted.mockResolvedValue(true);

      render(<NotificationPreferencesDialog {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText("tauriNotifEnabled")).toBeInTheDocument();
      });
    });

    it("shows pending status text when switch is ON but permission not yet granted", async () => {
      // desktopEnabledLocal defaults to true; permission is default.
      mockIsTauriNotificationGranted.mockResolvedValue(false);

      render(<NotificationPreferencesDialog {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText("tauriNotifPending")).toBeInTheDocument();
      });
      // Must not contradict the ON switch with the "click to enable" prompt.
      expect(screen.queryByText("tauriNotifPrompt")).not.toBeInTheDocument();
    });

    it("shows prompt status text when switch is OFF and permission not yet granted", async () => {
      localStorage.setItem("notification_desktop_enabled_local", "false");
      mockIsTauriNotificationGranted.mockResolvedValue(false);

      render(<NotificationPreferencesDialog {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText("tauriNotifPrompt")).toBeInTheDocument();
      });
    });

    it("toggling ON requests OS permission and persists local flag when granted", async () => {
      // Start from off.
      localStorage.setItem("notification_desktop_enabled_local", "false");
      mockRequestTauriPermission.mockResolvedValue("granted");

      render(<NotificationPreferencesDialog {...defaultProps} />);

      const switches = screen.getAllByRole("switch");
      fireEvent.click(switches[0]);

      await waitFor(() => {
        expect(mockRequestTauriPermission).toHaveBeenCalled();
      });

      expect(localStorage.getItem("notification_desktop_enabled_local")).toBe(
        "true",
      );
      // Web Push & server pref must not be touched in the Tauri branch.
      expect(mockSubscribe).not.toHaveBeenCalled();
      expect(mockUpdatePreferences).not.toHaveBeenCalled();
    });

    it("toggling ON does not flip the switch when user denies permission", async () => {
      localStorage.setItem("notification_desktop_enabled_local", "false");
      mockRequestTauriPermission.mockResolvedValue("denied");

      render(<NotificationPreferencesDialog {...defaultProps} />);

      const switches = screen.getAllByRole("switch");
      fireEvent.click(switches[0]);

      await waitFor(() => {
        expect(mockRequestTauriPermission).toHaveBeenCalled();
      });

      // Local flag stays false, switch stays unchecked.
      expect(localStorage.getItem("notification_desktop_enabled_local")).toBe(
        "false",
      );
      expect(switches[0]).toHaveAttribute("data-state", "unchecked");
      // Status text should now say denied.
      await waitFor(() => {
        expect(screen.getByText("tauriNotifDenied")).toBeInTheDocument();
      });
    });

    it('toggling ON does not flip the switch when user dismisses (permission "default")', async () => {
      localStorage.setItem("notification_desktop_enabled_local", "false");
      mockRequestTauriPermission.mockResolvedValue("default");

      render(<NotificationPreferencesDialog {...defaultProps} />);

      const switches = screen.getAllByRole("switch");
      fireEvent.click(switches[0]);

      await waitFor(() => {
        expect(mockRequestTauriPermission).toHaveBeenCalled();
      });

      expect(localStorage.getItem("notification_desktop_enabled_local")).toBe(
        "false",
      );
      expect(switches[0]).toHaveAttribute("data-state", "unchecked");
    });

    it("toggling OFF persists the local flag and does not call unsubscribe", async () => {
      // desktopEnabledLocal defaults to true in localStorage.
      render(<NotificationPreferencesDialog {...defaultProps} />);

      const switches = screen.getAllByRole("switch");
      fireEvent.click(switches[0]); // checked -> unchecked

      await waitFor(() => {
        expect(localStorage.getItem("notification_desktop_enabled_local")).toBe(
          "false",
        );
      });

      expect(mockRequestTauriPermission).not.toHaveBeenCalled();
      expect(mockUnsubscribe).not.toHaveBeenCalled();
      expect(mockUpdatePreferences).not.toHaveBeenCalled();
    });

    it("re-requests permission on each ON toggle — idempotent when already granted", async () => {
      // Simulates ON -> OFF -> ON. Second ON should still call
      // requestTauriNotificationPermission, which internally short-circuits on
      // already-granted without re-prompting the OS.
      mockRequestTauriPermission.mockResolvedValue("granted");

      render(<NotificationPreferencesDialog {...defaultProps} />);

      const switches = screen.getAllByRole("switch");
      // Starts ON by default; click OFF.
      fireEvent.click(switches[0]);
      await waitFor(() => {
        expect(localStorage.getItem("notification_desktop_enabled_local")).toBe(
          "false",
        );
      });
      expect(mockRequestTauriPermission).not.toHaveBeenCalled();

      // Click ON again.
      fireEvent.click(switches[0]);
      await waitFor(() => {
        expect(mockRequestTauriPermission).toHaveBeenCalledTimes(1);
      });
      expect(localStorage.getItem("notification_desktop_enabled_local")).toBe(
        "true",
      );
    });

    it("disables the switch when OS permission is already denied", async () => {
      // Start from off so the toggle attempt triggers the denied path.
      localStorage.setItem("notification_desktop_enabled_local", "false");
      mockRequestTauriPermission.mockResolvedValue("denied");

      render(<NotificationPreferencesDialog {...defaultProps} />);

      const switches = screen.getAllByRole("switch");
      fireEvent.click(switches[0]);

      await waitFor(() => {
        expect(switches[0]).toBeDisabled();
      });
    });
  });
});

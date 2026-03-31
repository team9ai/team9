import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ActivitySubSidebar } from "../ActivitySubSidebar";
import {
  ACTIVITY_TYPES,
  notificationActions,
  useNotificationStore,
  type Notification,
  type NotificationCounts,
} from "@/stores/useNotificationStore";

const mockNavigate = vi.hoisted(() => vi.fn());
const mockMarkAllAsRead = vi.hoisted(() => vi.fn());
let mockBulkIsPending = false;
const readAllLabel = "Mark all as read";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("react-i18next", () => ({
  useTranslation: (namespace?: string) => ({
    t: (key: string, options?: { ns?: string }) => {
      const ns = options?.ns ?? namespace;
      const labels: Record<string, string> = {
        activity: "Activity",
        activityUnread: "Unread",
        activityAll: "All",
        activityMentions: "Mentions",
        activityThreads: "Threads",
        noActivity: "No activity",
        markAllAsRead: readAllLabel,
      };

      if (ns === "message" && key === "markAllAsRead") {
        return labels.markAllAsRead;
      }

      return labels[key] ?? key;
    },
  }),
}));

vi.mock("@/components/activity/ActivityItem", () => ({
  ActivityItem: ({ notification }: { notification: Notification }) => (
    <div data-testid={`activity-item-${notification.id}`}>
      {notification.title}
    </div>
  ),
}));

vi.mock("@/hooks/useNotifications", () => ({
  useNotifications: () => ({ isLoading: false }),
  useMarkNotificationsAsRead: () => ({ mutate: vi.fn() }),
  useMarkAllNotificationsAsRead: () => ({
    mutate: mockMarkAllAsRead,
    isPending: mockBulkIsPending,
  }),
}));

const notifications: Notification[] = [
  {
    id: "n-1",
    category: "message",
    type: "mention",
    priority: "normal",
    title: "Mention",
    body: null,
    actor: null,
    tenantId: null,
    channelId: null,
    messageId: null,
    actionUrl: null,
    isRead: false,
    readAt: null,
    createdAt: "2026-03-31T00:00:00.000Z",
  },
  {
    id: "n-2",
    category: "message",
    type: "reply",
    priority: "normal",
    title: "Reply",
    body: null,
    actor: null,
    tenantId: null,
    channelId: null,
    messageId: null,
    actionUrl: null,
    isRead: false,
    readAt: null,
    createdAt: "2026-03-31T00:00:00.000Z",
  },
  {
    id: "n-3",
    category: "message",
    type: "dm_received",
    priority: "normal",
    title: "Direct message",
    body: null,
    actor: null,
    tenantId: null,
    channelId: null,
    messageId: null,
    actionUrl: null,
    isRead: false,
    readAt: null,
    createdAt: "2026-03-31T00:00:00.000Z",
  },
];

type NotificationCountsOverrides = {
  total?: number;
  byCategory?: Partial<NotificationCounts["byCategory"]>;
  byType?: Partial<NotificationCounts["byType"]>;
};

const counts = (
  overrides: NotificationCountsOverrides = {},
): NotificationCounts => ({
  total: overrides.total ?? 0,
  byCategory: {
    message: 0,
    system: 0,
    workspace: 0,
    ...overrides.byCategory,
  },
  byType: {
    mention: 0,
    channel_mention: 0,
    everyone_mention: 0,
    here_mention: 0,
    reply: 0,
    thread_reply: 0,
    dm_received: 0,
    system_announcement: 0,
    maintenance_notice: 0,
    version_update: 0,
    workspace_invitation: 0,
    role_changed: 0,
    member_joined: 0,
    member_left: 0,
    channel_invite: 0,
    ...overrides.byType,
  },
});

describe("ActivitySubSidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBulkIsPending = false;
    useNotificationStore.getState().reset();
  });

  it("calls markAllAsRead with Activity-scoped types on the All tab", () => {
    notificationActions.setNotifications(notifications);
    notificationActions.setCounts(
      counts({
        total: 3,
        byCategory: { message: 3, system: 0, workspace: 0 },
        byType: { mention: 1, reply: 1, dm_received: 1 },
      }),
    );
    notificationActions.setActiveTab("all");
    notificationActions.setShowUnreadOnly(false);

    render(<ActivitySubSidebar />);

    const button = screen.getByRole("button", { name: readAllLabel });
    expect(button).toBeEnabled();
    fireEvent.click(button);

    expect(mockMarkAllAsRead).toHaveBeenCalledWith({
      types: ACTIVITY_TYPES,
    });
  });

  it("calls markAllAsRead with mention types on the Mentions tab", () => {
    notificationActions.setNotifications([notifications[0]]);
    notificationActions.setCounts(
      counts({
        total: 1,
        byCategory: { message: 1, system: 0, workspace: 0 },
        byType: { mention: 1 },
      }),
    );
    notificationActions.setActiveTab("mentions");
    notificationActions.setShowUnreadOnly(false);

    render(<ActivitySubSidebar />);

    fireEvent.click(screen.getByRole("button", { name: readAllLabel }));

    expect(mockMarkAllAsRead).toHaveBeenCalledWith({
      types: ["mention", "channel_mention", "everyone_mention", "here_mention"],
    });
  });

  it("calls markAllAsRead with thread types on the Threads tab", () => {
    notificationActions.setNotifications([notifications[1]]);
    notificationActions.setCounts(
      counts({
        total: 1,
        byCategory: { message: 1, system: 0, workspace: 0 },
        byType: { reply: 1 },
      }),
    );
    notificationActions.setActiveTab("threads");
    notificationActions.setShowUnreadOnly(false);

    render(<ActivitySubSidebar />);

    fireEvent.click(screen.getByRole("button", { name: readAllLabel }));

    expect(mockMarkAllAsRead).toHaveBeenCalledWith({
      types: ["reply", "thread_reply"],
    });
  });

  it("disables Read All when the current filtered tab has no unread notifications", () => {
    notificationActions.setNotifications([
      { ...notifications[0], isRead: true, readAt: "2026-03-31T00:00:00.000Z" },
      notifications[1],
    ]);
    notificationActions.setCounts(
      counts({
        total: 1,
        byCategory: { message: 1, system: 0, workspace: 0 },
        byType: { reply: 1 },
      }),
    );
    notificationActions.setActiveTab("mentions");
    notificationActions.setShowUnreadOnly(false);

    render(<ActivitySubSidebar />);

    expect(screen.getByRole("button", { name: readAllLabel })).toBeDisabled();
  });

  it("disables Read All while the bulk mutation is pending", () => {
    mockBulkIsPending = true;
    notificationActions.setNotifications(notifications);
    notificationActions.setCounts(
      counts({
        total: 3,
        byCategory: { message: 3, system: 0, workspace: 0 },
        byType: { mention: 1, reply: 1, dm_received: 1 },
      }),
    );
    notificationActions.setActiveTab("all");
    notificationActions.setShowUnreadOnly(false);

    render(<ActivitySubSidebar />);

    expect(screen.getByRole("button", { name: readAllLabel })).toBeDisabled();
  });

  it("keeps Read All enabled when unread notifications exist outside the loaded page", () => {
    notificationActions.setNotifications([
      { ...notifications[0], isRead: true, readAt: "2026-03-31T00:00:00.000Z" },
    ]);
    notificationActions.setCounts(
      counts({
        total: 1,
        byCategory: { message: 1, system: 0, workspace: 0 },
        byType: { mention: 1 },
      }),
    );
    notificationActions.setActiveTab("mentions");
    notificationActions.setShowUnreadOnly(false);

    render(<ActivitySubSidebar />);

    expect(screen.getByRole("button", { name: readAllLabel })).toBeEnabled();
  });

  it("does not render DM notifications on the Activity All tab", () => {
    notificationActions.setNotifications(notifications);
    notificationActions.setCounts(
      counts({
        total: 3,
        byCategory: { message: 3, system: 0, workspace: 0 },
        byType: { mention: 1, reply: 1, dm_received: 1 },
      }),
    );
    notificationActions.setActiveTab("all");
    notificationActions.setShowUnreadOnly(false);

    render(<ActivitySubSidebar />);

    expect(screen.getByTestId("activity-item-n-1")).toBeInTheDocument();
    expect(screen.getByTestId("activity-item-n-2")).toBeInTheDocument();
    expect(screen.queryByTestId("activity-item-n-3")).not.toBeInTheDocument();
  });

  it("disables Read All on the Activity All tab when only DM notifications are unread", () => {
    notificationActions.setNotifications([notifications[2]]);
    notificationActions.setCounts(
      counts({
        total: 1,
        byCategory: { message: 1, system: 0, workspace: 0 },
        byType: { dm_received: 1 },
      }),
    );
    notificationActions.setActiveTab("all");
    notificationActions.setShowUnreadOnly(false);

    render(<ActivitySubSidebar />);

    expect(screen.getByRole("button", { name: readAllLabel })).toBeDisabled();
  });
});

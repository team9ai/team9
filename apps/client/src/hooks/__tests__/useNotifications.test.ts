import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  notificationActions,
  useNotificationStore,
  type Notification,
  type NotificationCounts,
} from "@/stores/useNotificationStore";

const mockQueryClient = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
}));

const mockMarkAsRead = vi.hoisted(() => vi.fn());
const mockMarkAllAsRead = vi.hoisted(() => vi.fn());
const capturedMutationOptions = vi.hoisted(() => ({
  current: undefined as
    | {
        mutationFn?: (variables: any) => Promise<any>;
        onSuccess?: (data: unknown, variables: any) => void;
      }
    | undefined,
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: (options: typeof capturedMutationOptions.current) => {
    capturedMutationOptions.current = options;
    return {
      mutateAsync: async (variables: unknown) =>
        options?.mutationFn?.(variables),
    };
  },
  useQueryClient: () => mockQueryClient,
  useQuery: vi.fn(),
}));

vi.mock("@/services/api/notification", () => ({
  default: {
    markAsRead: mockMarkAsRead,
    markAllAsRead: mockMarkAllAsRead,
  },
}));

import {
  useMarkNotificationsAsRead,
  useMarkAllNotificationsAsRead,
} from "../useNotifications";

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
];

const counts: NotificationCounts = {
  total: 2,
  byCategory: {
    message: 2,
    system: 0,
    workspace: 0,
  },
  byType: {
    mention: 1,
    channel_mention: 0,
    everyone_mention: 0,
    here_mention: 0,
    reply: 1,
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
  },
};

describe("useNotifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedMutationOptions.current = undefined;
    useNotificationStore.getState().reset();
    notificationActions.setNotifications(notifications);
    notificationActions.setCounts(counts);
  });

  it("forwards category and types to markAllAsRead and invalidates queries", async () => {
    renderHook(() => useMarkAllNotificationsAsRead());

    expect(capturedMutationOptions.current).toBeDefined();

    await capturedMutationOptions.current?.mutationFn?.({
      category: "message",
      types: ["mention", "reply"],
    });

    expect(mockMarkAllAsRead).toHaveBeenCalledWith("message", [
      "mention",
      "reply",
    ]);

    capturedMutationOptions.current?.onSuccess?.(undefined, {
      category: "message",
      types: ["mention", "reply"],
    });

    expect(useNotificationStore.getState().counts.total).toBe(0);
    expect(useNotificationStore.getState().counts.byCategory).toEqual({
      message: 0,
      system: 0,
      workspace: 0,
    });
    expect(useNotificationStore.getState().counts.byType).toMatchObject({
      mention: 0,
      reply: 0,
    });
    expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["notifications"],
    });
    expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["notificationCounts"],
    });
  });

  it("decrements type counts for unread notifications", () => {
    renderHook(() => useMarkNotificationsAsRead());

    expect(capturedMutationOptions.current).toBeDefined();
    capturedMutationOptions.current?.onSuccess?.(["n-1"], undefined);

    const state = useNotificationStore.getState();

    expect(state.counts.total).toBe(1);
    expect(state.counts.byCategory).toEqual({
      message: 1,
      system: 0,
      workspace: 0,
    });
    expect(state.counts.byType).toMatchObject({
      mention: 0,
      reply: 1,
    });
    expect(state.notifications[0]).toMatchObject({ isRead: true });
    expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["notifications"],
    });
    expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["notificationCounts"],
    });
  });
});

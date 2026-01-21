import { Filter, Search, Check, CheckCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Card } from "@/components/ui/card";
import { useNavigate } from "@tanstack/react-router";
import {
  useNotifications,
  useMarkNotificationsAsRead,
  useMarkAllNotificationsAsRead,
} from "@/hooks/useNotifications";
import {
  useNotifications as useNotificationsFromStore,
  useNotificationLoading,
  type Notification,
  type NotificationType,
} from "@/stores/useNotificationStore";
import { formatDistanceToNow } from "@/lib/date-utils";

function getNotificationIcon(type: NotificationType): string {
  switch (type) {
    case "mention":
    case "channel_mention":
    case "everyone_mention":
    case "here_mention":
      return "@";
    case "reply":
    case "thread_reply":
      return "↩";
    case "dm_received":
      return "✉";
    case "workspace_invitation":
      return "📨";
    case "role_changed":
      return "👤";
    case "member_joined":
      return "👋";
    case "member_left":
      return "👋";
    case "channel_invite":
      return "#";
    case "system_announcement":
    case "maintenance_notice":
    case "version_update":
      return "📢";
    default:
      return "🔔";
  }
}

function NotificationItem({
  notification,
  onMarkAsRead,
  onNavigate,
}: {
  notification: Notification;
  onMarkAsRead: (id: string) => void;
  onNavigate: (notification: Notification) => void;
}) {
  const timeAgo = formatDistanceToNow(new Date(notification.createdAt));

  const actorInitial =
    notification.actor?.displayName?.[0] ||
    notification.actor?.username?.[0]?.toUpperCase() ||
    "?";

  const actorName =
    notification.actor?.displayName || notification.actor?.username || "System";

  return (
    <Card
      className={`p-4 hover:shadow-md transition-shadow cursor-pointer ${
        !notification.isRead ? "bg-purple-50/50 dark:bg-purple-950/20" : ""
      }`}
      onClick={() => onNavigate(notification)}
    >
      <div className="flex gap-3">
        <Avatar className="w-10 h-10 shrink-0">
          <AvatarFallback className="bg-purple-600 text-white font-medium">
            {actorInitial}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 mb-1">
            <span className="font-semibold text-sm text-slate-900 dark:text-foreground">
              {actorName}
            </span>
            <span className="text-xs text-slate-500 dark:text-muted-foreground">
              {getNotificationIcon(notification.type)}
            </span>
            <span className="text-xs text-slate-400 dark:text-muted-foreground ml-auto">
              {timeAgo}
            </span>
          </div>
          <p className="text-sm text-slate-700 dark:text-foreground/80 font-medium">
            {notification.title}
          </p>
          {notification.body && (
            <p className="text-sm text-slate-500 dark:text-muted-foreground mt-1 line-clamp-2">
              {notification.body}
            </p>
          )}
        </div>
        {!notification.isRead && (
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 h-8 w-8 hover:bg-purple-100"
            onClick={(e) => {
              e.stopPropagation();
              onMarkAsRead(notification.id);
            }}
            title="Mark as read"
          >
            <Check size={16} className="text-purple-600" />
          </Button>
        )}
      </div>
    </Card>
  );
}

export function ActivityMainContent() {
  const navigate = useNavigate();

  // Fetch notifications on mount
  useNotifications();

  const notifications = useNotificationsFromStore();
  const isLoading = useNotificationLoading();

  const { mutate: markAsRead } = useMarkNotificationsAsRead();
  const { mutate: markAllAsRead, isPending: isMarkingAllAsRead } =
    useMarkAllNotificationsAsRead();

  const handleMarkAsRead = (notificationId: string) => {
    markAsRead([notificationId]);
  };

  const handleMarkAllAsRead = () => {
    markAllAsRead(undefined);
  };

  const handleNavigate = (notification: Notification) => {
    // Mark as read when navigating
    if (!notification.isRead) {
      markAsRead([notification.id]);
    }

    // Navigate to the relevant location
    if (notification.actionUrl) {
      navigate({ to: notification.actionUrl });
    } else if (notification.channelId) {
      navigate({ to: `/channels/${notification.channelId}` });
    }
  };

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  return (
    <main className="flex-1 flex flex-col bg-white dark:bg-background">
      {/* Content Header */}
      <header className="h-14 bg-white dark:bg-background flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-lg text-slate-900 dark:text-foreground">
            Activity
          </h2>
          {unreadCount > 0 && (
            <span className="bg-purple-100 text-purple-700 text-xs font-medium px-2 py-0.5 rounded-full">
              {unreadCount} unread
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-purple-600 hover:text-purple-700 hover:bg-purple-50"
              onClick={handleMarkAllAsRead}
              disabled={isMarkingAllAsRead}
            >
              {isMarkingAllAsRead ? (
                <Loader2 size={16} className="mr-1 animate-spin" />
              ) : (
                <CheckCheck size={16} className="mr-1" />
              )}
              Mark all read
            </Button>
          )}
          <Button variant="ghost" size="icon-sm" className="hover:bg-purple-50">
            <Filter
              size={18}
              className="text-slate-600 hover:text-purple-600"
            />
          </Button>
          <Button variant="ghost" size="icon-sm" className="hover:bg-purple-50">
            <Search
              size={18}
              className="text-slate-600 hover:text-purple-600"
            />
          </Button>
        </div>
      </header>

      <Separator />

      {/* Activity Feed */}
      <ScrollArea className="flex-1 bg-slate-50 dark:bg-background">
        <div className="p-4">
          {isLoading && notifications.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-500">
              <div className="text-4xl mb-4">🔔</div>
              <p className="text-lg font-medium">No notifications yet</p>
              <p className="text-sm text-slate-400 mt-1">
                You'll see mentions, replies, and other activity here
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {notifications.map((notification) => (
                <NotificationItem
                  key={notification.id}
                  notification={notification}
                  onMarkAsRead={handleMarkAsRead}
                  onNavigate={handleNavigate}
                />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </main>
  );
}

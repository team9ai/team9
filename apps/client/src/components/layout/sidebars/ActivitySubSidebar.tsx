import { Bell, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { ActivityItem } from "@/components/activity/ActivityItem";
import { useNotifications } from "@/hooks/useNotifications";
import {
  useFilteredNotifications,
  useActivityTab,
  useShowUnreadOnly,
  useNotificationLoading,
  notificationActions,
  type ActivityTab,
} from "@/stores/useNotificationStore";
import { useMarkNotificationsAsRead } from "@/hooks/useNotifications";
import { groupByDate } from "@/lib/date-utils";
import { useMemo } from "react";

interface TabConfig {
  id: ActivityTab;
  path: string;
  label: string;
}

export function ActivitySubSidebar() {
  const { t } = useTranslation("navigation");
  const location = useLocation();
  const navigate = useNavigate();

  // Tab configuration with translated labels
  const tabs: TabConfig[] = [
    { id: "all", path: "/activity", label: t("activityAll") },
    {
      id: "mentions",
      path: "/activity/mentions",
      label: t("activityMentions"),
    },
    { id: "threads", path: "/activity/threads", label: t("activityThreads") },
  ];

  // Fetch notifications on mount
  useNotifications();

  const notifications = useFilteredNotifications();
  const activeTab = useActivityTab();
  const showUnreadOnly = useShowUnreadOnly();
  const isLoading = useNotificationLoading();

  const { mutate: markAsRead } = useMarkNotificationsAsRead();

  // Group notifications by date
  const groupedNotifications = useMemo(() => {
    return groupByDate(notifications, (n) => new Date(n.createdAt), "zh");
  }, [notifications]);

  // Determine active tab from URL
  const currentPath = location.pathname;
  const currentTab = tabs.find((tab) => tab.path === currentPath)?.id || "all";

  // Sync tab state with URL
  if (currentTab !== activeTab) {
    notificationActions.setActiveTab(currentTab);
  }

  const handleActivityClick = (notification: (typeof notifications)[0]) => {
    // Mark as read
    if (!notification.isRead) {
      markAsRead([notification.id]);
    }

    // Navigate to the channel/message
    if (notification.actionUrl) {
      navigate({ to: notification.actionUrl });
    } else if (notification.channelId) {
      navigate({ to: `/channels/${notification.channelId}` });
    }
  };

  const toggleUnreadOnly = () => {
    notificationActions.setShowUnreadOnly(!showUnreadOnly);
  };

  return (
    <aside className="w-64 bg-[#5b2c6f] text-white flex flex-col">
      {/* Header */}
      <div className="p-4 pb-2">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-lg">{t("activity")}</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleUnreadOnly}
            className={cn(
              "h-7 px-2 text-xs",
              showUnreadOnly
                ? "bg-purple-400/30 text-white hover:bg-purple-400/40"
                : "text-white/70 hover:text-white hover:bg-white/10",
            )}
          >
            {t("activityUnread")}
          </Button>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="px-3 pb-2">
        <div className="flex gap-1 bg-white/10 rounded-lg p-1">
          {tabs.map((tab) => (
            <Link
              key={tab.id}
              to={tab.path}
              className={cn(
                "flex-1 px-2 py-1.5 text-xs font-medium text-center rounded-md transition-colors",
                currentPath === tab.path
                  ? "bg-white/20 text-white"
                  : "text-white/70 hover:text-white hover:bg-white/10",
              )}
            >
              {tab.label}
            </Link>
          ))}
        </div>
      </div>

      <Separator className="bg-white/10" />

      {/* Activity List */}
      <ScrollArea className="flex-1">
        <div className="px-2 py-2">
          {isLoading && notifications.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-white/50" />
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-white/50">
              <Bell size={32} className="mb-2" />
              <p className="text-sm">{t("noActivity")}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {groupedNotifications.map((group) => (
                <div key={group.dateKey}>
                  {/* Date Header */}
                  <div className="px-2 py-1.5 text-xs font-medium text-white/50">
                    {group.dateLabel}
                  </div>
                  {/* Activity Items */}
                  <div className="space-y-0.5">
                    {group.items.map((notification) => (
                      <ActivityItem
                        key={notification.id}
                        notification={notification}
                        onClick={() => handleActivityClick(notification)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}

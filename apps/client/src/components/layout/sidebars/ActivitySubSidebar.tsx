import { Bell, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActivityItem } from "@/components/activity/ActivityItem";
import { useNotifications } from "@/hooks/useNotifications";
import {
  useNotifications as useNotificationsFromStore,
  useActivityTab,
  useShowUnreadOnly,
  notificationActions,
  filterNotifications,
  type ActivityTab,
} from "@/stores/useNotificationStore";
import { useMarkNotificationsAsRead } from "@/hooks/useNotifications";
import { groupByDate } from "@/lib/date-utils";
import { useMemo } from "react";

export function ActivitySubSidebar() {
  const { t } = useTranslation("navigation");
  const navigate = useNavigate();

  // Fetch notifications on mount
  const { isLoading } = useNotifications();

  const allNotifications = useNotificationsFromStore();
  const activeTab = useActivityTab();
  const showUnreadOnly = useShowUnreadOnly();

  // Filter notifications using useMemo to avoid creating new array references on every render
  const notifications = useMemo(
    () => filterNotifications(allNotifications, activeTab, showUnreadOnly),
    [allNotifications, activeTab, showUnreadOnly],
  );

  const { mutate: markAsRead } = useMarkNotificationsAsRead();

  // Group notifications by date
  const groupedNotifications = useMemo(() => {
    return groupByDate(notifications, (n) => new Date(n.createdAt), "zh");
  }, [notifications]);

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

  const handleTabChange = (value: string) => {
    notificationActions.setActiveTab(value as ActivityTab);
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
        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <TabsList className="w-full bg-white/10 border-none rounded-lg p-1">
            <TabsTrigger
              value="all"
              className="flex-1 text-xs data-[state=active]:bg-white/20 data-[state=active]:text-white data-[state=inactive]:text-white/70 border-none rounded-md"
            >
              {t("activityAll")}
            </TabsTrigger>
            <TabsTrigger
              value="mentions"
              className="flex-1 text-xs data-[state=active]:bg-white/20 data-[state=active]:text-white data-[state=inactive]:text-white/70 border-none rounded-md"
            >
              {t("activityMentions")}
            </TabsTrigger>
            <TabsTrigger
              value="threads"
              className="flex-1 text-xs data-[state=active]:bg-white/20 data-[state=active]:text-white data-[state=inactive]:text-white/70 border-none rounded-md"
            >
              {t("activityThreads")}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Activity List */}
      <ScrollArea className="flex-1 [&>[data-slot=scroll-area-viewport]>div]:block!">
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

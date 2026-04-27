import { useState } from "react";
import {
  Home,
  MessageSquare,
  Bell,
  MoreHorizontal,
  IdCard,
  ListChecks,
  Box,
  Library,
  LayoutGrid,
  Sparkles,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { NotificationBadge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useChannelsByType } from "@/hooks/useChannels";
import { useNotificationCounts } from "@/hooks/useNotifications";
import {
  appActions,
  getLastVisitedPath,
  getSectionFromPath,
  type SidebarSection,
} from "@/stores";
import {
  getVisibleNavigationItems,
  isHiddenNavUnlocked,
  registerMoreTapUnlock,
} from "./mainSidebarUnlock";

export const navigationItems = [
  { id: "home", labelKey: "home" as const, icon: Home },
  { id: "messages", labelKey: "dms" as const, icon: MessageSquare },
  { id: "activity", labelKey: "activity" as const, icon: Bell },
  { id: "aiStaff", labelKey: "staff" as const, icon: IdCard },
  { id: "routines", labelKey: "routines" as const, icon: ListChecks },
  { id: "skills", labelKey: "skills" as const, icon: Sparkles },
  { id: "resources", labelKey: "resources" as const, icon: Box },
  { id: "wiki", labelKey: "wiki" as const, icon: Library },
  { id: "application", labelKey: "application" as const, icon: LayoutGrid },
  { id: "more", labelKey: "more" as const, icon: MoreHorizontal },
];

/**
 * Renders the shared navigation button list used by both the collapsed-mode
 * inline nav (inside the workspace rail) and the expanded-mode nav rail.
 * Since only one instance mounts at a time (collapse-dependent), the
 * `hiddenNavUnlocked` local state stays in sync via localStorage.
 */
export function NavigationRail() {
  const { t: tNav } = useTranslation("navigation");
  const navigate = useNavigate();
  const location = useLocation();
  const { data: notificationCounts } = useNotificationCounts();
  const { directChannels = [] } = useChannelsByType();
  const [hiddenNavUnlocked, setHiddenNavUnlocked] = useState(() =>
    isHiddenNavUnlocked(),
  );

  const activityUnreadCount =
    (notificationCounts?.total ?? 0) -
    (notificationCounts?.byType?.dm_received ?? 0);

  const dmUnreadCount = directChannels.reduce(
    (sum, ch) => sum + (ch.unreadCount || 0),
    0,
  );

  return (
    <>
      {getVisibleNavigationItems(navigationItems, hiddenNavUnlocked).map(
        (item) => {
          const Icon = item.icon;
          const currentSection = location.pathname.startsWith("/profile")
            ? null
            : getSectionFromPath(location.pathname);
          const isActive = currentSection === item.id;
          const label = tNav(item.labelKey);

          const badgeCount =
            item.id === "activity"
              ? activityUnreadCount
              : item.id === "messages"
                ? dmUnreadCount
                : 0;

          return (
            <Button
              key={item.id}
              variant="ghost"
              size="icon"
              onClick={() => {
                const section = item.id as SidebarSection;

                if (section === "more" && !hiddenNavUnlocked) {
                  const unlocked = registerMoreTapUnlock();
                  if (unlocked) {
                    setHiddenNavUnlocked(true);
                  }
                }

                appActions.setActiveSidebar(section);
                const targetPath =
                  section === "home"
                    ? "/channels"
                    : getLastVisitedPath(section);
                navigate({ to: targetPath as never });
              }}
              className={cn(
                "w-12 h-12 rounded-lg flex flex-col items-center justify-center gap-0.5 transition-all hover:bg-nav-hover text-nav-foreground-subtle hover:text-nav-foreground relative",
                isActive && "bg-nav-active text-nav-foreground",
              )}
              title={label}
            >
              <div className="relative">
                <Icon size={20} />
                <NotificationBadge count={badgeCount} />
              </div>
              <span className="text-xs mt-1">{label}</span>
            </Button>
          );
        },
      )}
    </>
  );
}

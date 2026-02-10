import {
  Home,
  MessageSquare,
  Bell,
  FileText,
  MoreHorizontal,
  MoreVertical,
  Smile,
  ChevronRight,
  User,
  Settings,
  LogOut,
  Globe,
  Plus,
  Bot,
  LayoutGrid,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { supportedLanguages } from "@/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { useNavigate, useLocation } from "@tanstack/react-router";
import { useUserWorkspaces } from "@/hooks/useWorkspace";
import {
  useWorkspaceStore,
  appActions,
  getLastVisitedPath,
  getSectionFromPath,
  useSidebarCollapsed,
  type SidebarSection,
} from "@/stores";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useCurrentUser, useLogout } from "@/hooks/useAuth";
import { useUpdateStatus, useOnlineUsers } from "@/hooks/useIMUsers";
import { useNotificationCounts } from "@/hooks/useNotifications";
import { useChannelsByType } from "@/hooks/useChannels";
import { NotificationBadge } from "@/components/ui/badge";
import { CreateWorkspaceDialog } from "@/components/dialog/CreateWorkspaceDialog";
import type { UserStatus } from "@/types/im";

// Navigation items with i18n keys
const navigationItems = [
  { id: "home", labelKey: "home" as const, icon: Home },
  { id: "messages", labelKey: "dms" as const, icon: MessageSquare },
  { id: "activity", labelKey: "activity" as const, icon: Bell },
  { id: "files", labelKey: "files" as const, icon: FileText },
  { id: "aiStaff", labelKey: "aiStaff" as const, icon: Bot },
  { id: "application", labelKey: "application" as const, icon: LayoutGrid },
  { id: "more", labelKey: "more" as const, icon: MoreHorizontal },
];

// Workspace avatar colors (similar to Google Chrome)
const WORKSPACE_COLORS = [
  "bg-red-500",
  "bg-orange-500",
  "bg-amber-500",
  "bg-yellow-500",
  "bg-lime-500",
  "bg-green-500",
  "bg-teal-500",
  "bg-cyan-500",
  "bg-blue-500",
  "bg-purple-500",
];

export function MainSidebar() {
  const { t: tNav, i18n } = useTranslation("navigation");
  const { t: tSettings } = useTranslation("settings");
  const { t: tAuth } = useTranslation("auth");
  const { t: tCommon } = useTranslation("common");

  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { data: workspaces, isLoading } = useUserWorkspaces();
  const { selectedWorkspaceId, setSelectedWorkspaceId } = useWorkspaceStore();
  const prevWorkspaceIdRef = useRef<string | null>(null);

  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [moreWorkspacesOpen, setMoreWorkspacesOpen] = useState(false);
  const [createWorkspaceOpen, setCreateWorkspaceOpen] = useState(false);
  const { data: currentUser } = useCurrentUser();
  const { mutate: logout } = useLogout();
  const { mutate: updateStatus } = useUpdateStatus();
  const { data: onlineUsers = {} } = useOnlineUsers();
  const { data: notificationCounts } = useNotificationCounts();
  const { directChannels = [] } = useChannelsByType();

  // Activity count excludes dm_received notifications (those are shown on Messages)
  const activityUnreadCount =
    (notificationCounts?.total ?? 0) -
    (notificationCounts?.byType?.dm_received ?? 0);

  const dmUnreadCount = directChannels.reduce(
    (sum, ch) => sum + (ch.unreadCount || 0),
    0,
  );

  const currentWorkspaceName =
    workspaces?.find((w) => w.id === selectedWorkspaceId)?.name || "Workspace";

  const userStatus: UserStatus =
    currentUser?.id && onlineUsers[currentUser.id]
      ? (onlineUsers[currentUser.id] as UserStatus)
      : "online";
  const isOnline = userStatus === "online";

  const handleStatusToggle = () => {
    const newStatus: UserStatus = isOnline ? "offline" : "online";
    updateStatus({ status: newStatus });
  };

  const handleLogout = () => {
    setUserMenuOpen(false);
    logout();
    navigate({ to: "/login" });
  };

  const getStatusColor = (status: UserStatus) => {
    switch (status) {
      case "online":
        return "bg-success";
      case "away":
        return "bg-warning";
      case "busy":
        return "bg-destructive";
      default:
        return "bg-muted-foreground";
    }
  };

  const getStatusLabel = (status: UserStatus) => {
    const statusMap = {
      online: tSettings("status.online"),
      away: tSettings("status.away"),
      busy: tSettings("status.busy"),
      offline: tSettings("status.offline"),
    } as const;
    return statusMap[status] || statusMap.offline;
  };

  // Get first 5 workspaces and remaining ones
  const visibleWorkspaces = workspaces?.slice(0, 3) || [];
  const moreWorkspaces = workspaces?.slice(3) || [];
  const hasMoreWorkspaces = moreWorkspaces.length > 0;

  // Set first workspace as selected by default
  const currentWorkspace =
    workspaces?.find((w) => w.id === selectedWorkspaceId) || workspaces?.[0];

  // Initialize or fix selectedWorkspaceId
  useEffect(() => {
    if (workspaces && workspaces.length > 0) {
      const isValid =
        selectedWorkspaceId &&
        workspaces.some((w) => w.id === selectedWorkspaceId);
      if (!isValid) {
        if (import.meta.env.DEV) {
          console.log(
            "[MainSidebar] Resetting workspace to:",
            workspaces[0].id,
            selectedWorkspaceId
              ? "(previous workspace not found in user's workspaces)"
              : "(no workspace selected)",
          );
        }
        setSelectedWorkspaceId(workspaces[0].id);
      }
    }
  }, [workspaces, selectedWorkspaceId, setSelectedWorkspaceId]);

  // Clear workspace-specific cache when workspace changes
  useEffect(() => {
    if (
      selectedWorkspaceId &&
      prevWorkspaceIdRef.current !== null &&
      prevWorkspaceIdRef.current !== selectedWorkspaceId
    ) {
      if (import.meta.env.DEV) {
        console.log(
          "[MainSidebar] Workspace changed from",
          prevWorkspaceIdRef.current,
          "to",
          selectedWorkspaceId,
        );
      }

      // Remove old workspace queries to free memory and ensure fresh data
      queryClient.removeQueries({
        queryKey: ["channels", prevWorkspaceIdRef.current],
      });
      queryClient.removeQueries({
        queryKey: ["workspace-members", prevWorkspaceIdRef.current],
      });
      queryClient.removeQueries({
        queryKey: ["installed-applications", prevWorkspaceIdRef.current],
      });
      queryClient.removeQueries({
        queryKey: ["installed-application", prevWorkspaceIdRef.current],
      });
      queryClient.removeQueries({
        queryKey: ["openclaw-status", prevWorkspaceIdRef.current],
      });
      queryClient.removeQueries({
        queryKey: ["openclaw-bots", prevWorkspaceIdRef.current],
      });
      queryClient.removeQueries({
        queryKey: ["openclaw-workspaces", prevWorkspaceIdRef.current],
      });
      queryClient.removeQueries({
        queryKey: ["workspace-files", prevWorkspaceIdRef.current],
      });
      queryClient.removeQueries({
        queryKey: ["file-keeper-token", prevWorkspaceIdRef.current],
      });
      // Note: Don't remove messages as they might be needed if user navigates back

      // Reset last visited paths — detail pages belong to the old workspace
      const sections: SidebarSection[] = [
        "home",
        "messages",
        "activity",
        "files",
        "aiStaff",
        "application",
        "more",
      ];
      for (const section of sections) {
        appActions.setLastVisitedPath(section, null);
      }

      // Navigate to home when switching workspace
      navigate({ to: "/" });
    }
    prevWorkspaceIdRef.current = selectedWorkspaceId;
  }, [selectedWorkspaceId, queryClient, navigate]);

  const getInitials = (name: string) => {
    const words = name.trim().split(/\s+/);
    if (words.length === 1) {
      return words[0][0].toUpperCase();
    }
    return (words[0][0] + words[1][0]).toUpperCase();
  };

  const getWorkspaceColor = (index: number) => {
    return WORKSPACE_COLORS[index % WORKSPACE_COLORS.length];
  };

  const sidebarCollapsed = useSidebarCollapsed();

  const renderNavigationItems = () =>
    navigationItems.map((item) => {
      const Icon = item.icon;
      const currentSection = getSectionFromPath(location.pathname);
      const isActive = currentSection === item.id;
      const label = tNav(item.labelKey);

      const getBadgeCount = () => {
        if (item.id === "activity") return activityUnreadCount;
        if (item.id === "messages") return dmUnreadCount;
        return 0;
      };
      const badgeCount = getBadgeCount();

      return (
        <Button
          key={item.id}
          variant="ghost"
          size="icon"
          onClick={() => {
            const section = item.id as SidebarSection;
            appActions.setActiveSidebar(section);
            const targetPath = getLastVisitedPath(section);
            navigate({ to: targetPath });
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
          <span className="text-xs mt-1.5">{label}</span>
        </Button>
      );
    });

  return (
    <TooltipProvider>
      <CreateWorkspaceDialog
        isOpen={createWorkspaceOpen}
        onClose={() => setCreateWorkspaceOpen(false)}
      />
      <div className="flex h-full">
        {/* Column 1: Workspace avatars - always visible */}
        <aside className="w-16 h-full bg-nav-bg text-primary-foreground flex flex-col items-center overflow-hidden">
          <div className="flex-1 min-h-0 w-full overflow-y-auto scrollbar-hide flex flex-col items-center pt-4 space-y-3">
            {isLoading ? (
              <Avatar className="w-10 h-10">
                <AvatarFallback className="bg-background text-foreground rounded-lg">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-foreground" />
                </AvatarFallback>
              </Avatar>
            ) : visibleWorkspaces.length === 0 ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Avatar className="w-10 h-10 cursor-pointer hover:opacity-80 transition-opacity">
                    <AvatarFallback className="bg-background text-foreground rounded-full font-bold text-base">
                      🏋
                    </AvatarFallback>
                  </Avatar>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <p>{tNav("noWorkspace")}</p>
                </TooltipContent>
              </Tooltip>
            ) : sidebarCollapsed && workspaces && workspaces.length > 1 ? (
              /* Stacked workspace avatars when collapsed - current on top */
              (() => {
                const currentIdx = workspaces.findIndex(
                  (w) => w.id === currentWorkspace?.id,
                );
                const others = workspaces.filter(
                  (w) => w.id !== currentWorkspace?.id,
                );
                const behindCount = Math.min(others.length, 2);
                return (
                  <Popover>
                    <PopoverTrigger asChild>
                      <div
                        className="relative cursor-pointer shrink-0"
                        style={{
                          height: `${40 + behindCount * 4}px`,
                          width: `${40 + behindCount * 4}px`,
                        }}
                      >
                        {/* Background avatars (behind, offset) */}
                        {others.slice(0, 2).map((workspace, i) => {
                          const origIdx = workspaces.indexOf(workspace);
                          return (
                            <Avatar
                              key={workspace.id}
                              className="absolute border-2 border-nav-bg opacity-70"
                              style={{
                                width: "32px",
                                height: "32px",
                                bottom: `${i * 4}px`,
                                right: `${i * 4}px`,
                                zIndex: i,
                              }}
                            >
                              <AvatarFallback
                                className={cn(
                                  "rounded-full font-bold text-xs text-nav-foreground",
                                  getWorkspaceColor(origIdx),
                                )}
                              >
                                {getInitials(workspace.name)}
                              </AvatarFallback>
                            </Avatar>
                          );
                        })}
                        {/* Current workspace avatar (on top) */}
                        {currentWorkspace && (
                          <Avatar
                            className="w-10 h-10 absolute top-0 left-0 border-2 border-nav-bg ring-2 ring-nav-foreground ring-offset-1 ring-offset-nav-bg"
                            style={{ zIndex: 10 }}
                          >
                            <AvatarFallback
                              className={cn(
                                "rounded-full font-bold text-base text-nav-foreground",
                                getWorkspaceColor(
                                  currentIdx >= 0 ? currentIdx : 0,
                                ),
                              )}
                            >
                              {getInitials(currentWorkspace.name)}
                            </AvatarFallback>
                          </Avatar>
                        )}
                      </div>
                    </PopoverTrigger>
                    <PopoverContent side="right" className="w-56 p-2">
                      <div className="space-y-1">
                        <p className="font-semibold text-xs mb-2 text-muted-foreground px-2">
                          {tNav("moreWorkspaces")}
                        </p>
                        {workspaces.map((workspace, index) => (
                          <button
                            key={workspace.id}
                            onClick={() => setSelectedWorkspaceId(workspace.id)}
                            className={cn(
                              "flex items-center gap-2 w-full text-left px-2 py-1.5 text-sm hover:bg-accent rounded transition-colors",
                              currentWorkspace?.id === workspace.id &&
                                "bg-accent",
                            )}
                          >
                            <div
                              className={cn(
                                "w-6 h-6 rounded-full flex items-center justify-center text-nav-foreground text-xs font-bold",
                                getWorkspaceColor(index),
                              )}
                            >
                              {getInitials(workspace.name)}
                            </div>
                            <span>{workspace.name}</span>
                          </button>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                );
              })()
            ) : (
              visibleWorkspaces.map((workspace, index) => (
                <Tooltip key={workspace.id}>
                  <TooltipTrigger asChild>
                    <Avatar
                      className={cn(
                        "w-10 h-10 cursor-pointer transition-all",
                        currentWorkspace?.id === workspace.id
                          ? "ring-2 ring-nav-foreground ring-offset-2 ring-offset-nav-bg"
                          : "hover:opacity-80",
                      )}
                      onClick={() => setSelectedWorkspaceId(workspace.id)}
                    >
                      <AvatarFallback
                        className={cn(
                          "rounded-full font-bold text-base text-nav-foreground",
                          getWorkspaceColor(index),
                        )}
                      >
                        {getInitials(workspace.name)}
                      </AvatarFallback>
                    </Avatar>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    <p>{workspace.name}</p>
                  </TooltipContent>
                </Tooltip>
              ))
            )}

            {/* More Workspaces Button - only when expanded */}
            {!sidebarCollapsed && hasMoreWorkspaces && (
              <Popover
                open={moreWorkspacesOpen}
                onOpenChange={setMoreWorkspacesOpen}
              >
                <PopoverTrigger asChild>
                  <Avatar className="w-10 h-10 cursor-pointer hover:opacity-80 transition-opacity">
                    <AvatarFallback className="bg-nav-hover-strong text-nav-foreground rounded-full">
                      <MoreVertical size={18} />
                    </AvatarFallback>
                  </Avatar>
                </PopoverTrigger>
                <PopoverContent side="right" className="w-56 p-2">
                  <div className="space-y-1">
                    <p className="font-semibold text-xs mb-2 text-muted-foreground px-2">
                      {tNav("moreWorkspaces")}
                    </p>
                    {moreWorkspaces.map((workspace, index) => {
                      const moreIndex = 5 + index; // Continue color sequence
                      return (
                        <button
                          key={workspace.id}
                          onClick={() => {
                            setSelectedWorkspaceId(workspace.id);
                            setMoreWorkspacesOpen(false);
                          }}
                          className="flex items-center gap-2 w-full text-left px-2 py-1.5 text-sm hover:bg-accent rounded transition-colors"
                        >
                          <div
                            className={cn(
                              "w-6 h-6 rounded-full flex items-center justify-center text-nav-foreground text-xs font-bold",
                              getWorkspaceColor(moreIndex),
                            )}
                          >
                            {getInitials(workspace.name)}
                          </div>
                          <span>{workspace.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </PopoverContent>
              </Popover>
            )}

            {/* Create Workspace Button - only when expanded */}
            {!sidebarCollapsed && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Avatar
                    className="w-10 h-10 cursor-pointer hover:opacity-80 transition-opacity"
                    onClick={() => setCreateWorkspaceOpen(true)}
                  >
                    <AvatarFallback className="bg-nav-hover-strong hover:bg-nav-hover-stronger text-nav-foreground rounded-full border-2 border-dashed border-nav-border-muted">
                      <Plus size={18} />
                    </AvatarFallback>
                  </Avatar>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <p>{tNav("createWorkspace")}</p>
                </TooltipContent>
              </Tooltip>
            )}

            {/* Navigation Items - shown here when sidebar is collapsed */}
            {sidebarCollapsed && (
              <nav className="w-full flex flex-col items-center space-y-1 border-border">
                {renderNavigationItems()}
              </nav>
            )}
          </div>

          {/* User Avatar at Bottom */}
          <div className="shrink-0 py-4">
            <Popover open={userMenuOpen} onOpenChange={setUserMenuOpen}>
              <PopoverTrigger asChild>
                <div className="relative cursor-pointer">
                  <Avatar className="w-10 h-10">
                    <AvatarFallback className="bg-primary hover:bg-primary/90 transition-colors text-primary-foreground text-sm font-medium">
                      {currentUser?.displayName?.[0] ||
                        currentUser?.username?.[0]?.toUpperCase() ||
                        "U"}
                    </AvatarFallback>
                  </Avatar>
                  <div
                    className={cn(
                      "absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-nav-bg",
                      getStatusColor(userStatus),
                    )}
                  />
                </div>
              </PopoverTrigger>
              <PopoverContent
                side="right"
                align="end"
                className="w-72 p-0"
                sideOffset={8}
              >
                {/* User Info Header */}
                <div className="p-4">
                  <div className="flex items-center gap-3">
                    <Avatar className="w-12 h-12">
                      <AvatarFallback className="bg-primary text-primary-foreground text-lg font-medium">
                        {currentUser?.displayName?.[0] ||
                          currentUser?.username?.[0]?.toUpperCase() ||
                          "U"}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-semibold text-sm">
                        {currentUser?.displayName ||
                          currentUser?.username ||
                          "User"}
                      </p>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <div
                          className={cn(
                            "w-2 h-2 rounded-full",
                            getStatusColor(userStatus),
                          )}
                        />
                        <span>{getStatusLabel(userStatus)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Status Input */}
                  <div className="mt-3">
                    <div className="flex items-center gap-2 px-3 py-2 border rounded-md text-sm text-muted-foreground hover:bg-accent cursor-pointer">
                      <Smile size={16} />
                      <span>{tSettings("updateStatus")}</span>
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Status Toggle */}
                <div className="py-1">
                  <button
                    onClick={handleStatusToggle}
                    className="w-full flex items-center justify-between px-4 py-2 text-sm hover:bg-accent"
                  >
                    <span>
                      {tSettings("setStatus", {
                        status: isOnline
                          ? tSettings("status.offline")
                          : tSettings("status.online"),
                      })}
                    </span>
                  </button>
                  <button className="w-full flex items-center justify-between px-4 py-2 text-sm hover:bg-accent">
                    <span>{tSettings("pauseNotifications")}</span>
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <span>{tCommon("on")}</span>
                      <ChevronRight size={14} />
                    </div>
                  </button>
                </div>

                <Separator />

                {/* Profile & Settings */}
                <div className="py-1">
                  <button className="w-full flex items-center gap-3 px-4 py-2 text-sm hover:bg-accent">
                    <User size={16} />
                    <span>{tSettings("profile")}</span>
                  </button>
                  <button className="w-full flex items-center justify-between px-4 py-2 text-sm hover:bg-accent">
                    <div className="flex items-center gap-3">
                      <Settings size={16} />
                      <span>{tSettings("preferences")}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">⌘,</span>
                  </button>
                </div>

                <Separator />

                {/* Language Switcher */}
                <div className="py-1">
                  <div className="px-4 py-1.5 text-xs font-semibold text-muted-foreground">
                    {tSettings("language")}
                  </div>
                  {supportedLanguages.map((lang) =>
                    lang.code === "zh" ? (
                      <></>
                    ) : (
                      <button
                        key={lang.code}
                        onClick={() => i18n.changeLanguage(lang.code)}
                        className={cn(
                          "w-full flex items-center justify-between px-4 py-2 text-sm hover:bg-accent",
                          i18n.language === lang.code && "bg-accent",
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <Globe size={16} />
                          <span>{lang.nativeName}</span>
                        </div>
                        {i18n.language === lang.code && (
                          <span className="text-primary">✓</span>
                        )}
                      </button>
                    ),
                  )}
                </div>

                <Separator />

                {/* Logout */}
                <div className="py-1">
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-3 px-4 py-2 text-sm hover:bg-accent text-destructive"
                  >
                    <LogOut size={16} />
                    <span>
                      {tAuth("signOutFrom", {
                        workspace: currentWorkspaceName,
                      })}
                    </span>
                  </button>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </aside>

        {/* Column 2: Navigation items - only when expanded */}
        {!sidebarCollapsed && (
          <>
            <nav className="w-16 h-full bg-nav-sub-bg text-primary-foreground flex flex-col items-center pt-4 space-y-1 overflow-y-auto scrollbar-hide">
              {renderNavigationItems()}
            </nav>
            <div className="w-px h-full bg-border shrink-0" />
          </>
        )}
      </div>
    </TooltipProvider>
  );
}

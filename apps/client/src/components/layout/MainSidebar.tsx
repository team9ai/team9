import {
  Home,
  MessageSquare,
  Bell,
  MoreHorizontal,
  User,
  LogOut,
  Globe,
  Plus,
  IdCard,
  ListChecks,
  Box,
  Library,
  LayoutGrid,
  Sparkles,
  Loader2,
  ChevronRight,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { supportedLanguages } from "@/i18n";
import { changeLanguage, useLanguageLoading } from "@/i18n/loadLanguage";
import { getInitials, getSeededAvatarGradient } from "@/lib/avatar-colors";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { UserAvatar } from "@/components/ui/user-avatar";
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
import { useOnlineUsers } from "@/hooks/useIMUsers";
import { useNotificationCounts } from "@/hooks/useNotifications";
import { useAHandSetupStore } from "@/stores/useAHandSetupStore";
import { useChannelsByType } from "@/hooks/useChannels";
import { useDevtools } from "@/hooks/useDevtools";
import { NotificationBadge } from "@/components/ui/badge";
import { CreateWorkspaceDialog } from "@/components/dialog/CreateWorkspaceDialog";
import {
  getVisibleNavigationItems,
  isHiddenNavUnlocked,
  registerMoreTapUnlock,
} from "./mainSidebarUnlock";
import type { UserStatus } from "@/types/im";

// Navigation items with i18n keys
const navigationItems = [
  { id: "home", labelKey: "home" as const, icon: Home },
  { id: "messages", labelKey: "dms" as const, icon: MessageSquare },
  { id: "activity", labelKey: "activity" as const, icon: Bell },
  // { id: "files", labelKey: "files" as const, icon: FileText },
  { id: "aiStaff", labelKey: "staff" as const, icon: IdCard },
  { id: "routines", labelKey: "routines" as const, icon: ListChecks },
  { id: "skills", labelKey: "skills" as const, icon: Sparkles },
  { id: "resources", labelKey: "resources" as const, icon: Box },
  { id: "library", labelKey: "library" as const, icon: Library },
  { id: "application", labelKey: "application" as const, icon: LayoutGrid },
  { id: "more", labelKey: "more" as const, icon: MoreHorizontal },
];

export function MainSidebar() {
  const { t: tNav, i18n } = useTranslation("navigation");
  const { t: tSettings } = useTranslation("settings");
  const { t: tAuth } = useTranslation("auth");
  const { isLoading: isLanguageLoading } = useLanguageLoading();

  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { data: workspaces, isLoading } = useUserWorkspaces();
  const { selectedWorkspaceId, setSelectedWorkspaceId } = useWorkspaceStore();
  const prevWorkspaceIdRef = useRef<string | null>(null);

  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
  const [createWorkspaceOpen, setCreateWorkspaceOpen] = useState(false);
  const [hiddenNavUnlocked, setHiddenNavUnlocked] = useState(() =>
    isHiddenNavUnlocked(),
  );
  const { data: currentUser } = useCurrentUser();
  const { mutateAsync: logout, isPending: isLoggingOut } = useLogout();
  const { data: onlineUsers = {} } = useOnlineUsers();
  const { data: notificationCounts } = useNotificationCounts();
  const { directChannels = [] } = useChannelsByType();
  const { handleTap: devtoolsTap, message: devtoolsMessage } = useDevtools();

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

  const handleLogout = async () => {
    setUserMenuOpen(false);
    try {
      await logout();
    } finally {
      navigate({ to: "/login", replace: true });
    }
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

  const visibleWorkspaces = workspaces || [];

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
        queryKey: [
          "installed-applications-with-bots",
          prevWorkspaceIdRef.current,
        ],
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

      // Reset last visited paths — persisted section routes may not exist
      // or may point at stale detail pages in the next workspace.
      appActions.resetNavigationForWorkspaceEntry();

      // Reset aHand setup state so it re-runs for the new workspace
      useAHandSetupStore.getState().reset();

      // Navigate to home when switching workspace
      navigate({ to: "/" });
    }
    prevWorkspaceIdRef.current = selectedWorkspaceId;
  }, [selectedWorkspaceId, queryClient, navigate]);

  const sidebarCollapsed = useSidebarCollapsed();

  const renderNavigationItems = () =>
    getVisibleNavigationItems(navigationItems, hiddenNavUnlocked).map(
      (item) => {
        const Icon = item.icon;
        const currentSection = location.pathname.startsWith("/profile")
          ? null
          : getSectionFromPath(location.pathname);
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

              if (section === "more" && !hiddenNavUnlocked) {
                const unlocked = registerMoreTapUnlock();
                if (unlocked) {
                  setHiddenNavUnlocked(true);
                }
              }

              appActions.setActiveSidebar(section);
              const targetPath =
                section === "home" ? "/channels" : getLastVisitedPath(section);
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
      },
    );

  return (
    <TooltipProvider>
      <CreateWorkspaceDialog
        isOpen={createWorkspaceOpen}
        onClose={() => setCreateWorkspaceOpen(false)}
      />
      <div className="flex h-full">
        {/* Column 1: Workspace avatars - always visible */}
        <aside
          data-tauri-drag-region
          className="w-16 h-full bg-nav-bg text-primary-foreground flex flex-col items-center overflow-hidden"
        >
          <div
            data-tauri-drag-region
            className="flex-1 min-h-0 w-full overflow-y-auto scrollbar-hide flex flex-col items-center pt-4 space-y-3"
          >
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
                          width: "40px",
                        }}
                      >
                        {/* Background avatars (behind, offset) */}
                        {others.slice(0, 2).map((workspace, i) => {
                          return (
                            <div
                              key={workspace.id}
                              className={cn(
                                "absolute flex items-center justify-center bg-linear-to-br text-white text-xs font-semibold rounded-lg border-2 border-nav-bg opacity-60",
                                getSeededAvatarGradient(workspace.id),
                              )}
                              style={{
                                width: "32px",
                                height: "32px",
                                bottom: `${i * 4}px`,
                                left: "4px",
                                zIndex: i,
                              }}
                            >
                              {getInitials(workspace.name)}
                            </div>
                          );
                        })}
                        {/* Current workspace avatar (on top) */}
                        {currentWorkspace && (
                          <div
                            className={cn(
                              "w-10 h-10 absolute top-0 left-0 flex items-center justify-center bg-linear-to-br text-white text-sm font-semibold rounded-xl shadow-md",
                              getSeededAvatarGradient(currentWorkspace.id),
                            )}
                            style={{ zIndex: 10 }}
                          >
                            {getInitials(currentWorkspace.name)}
                          </div>
                        )}
                      </div>
                    </PopoverTrigger>
                    <PopoverContent side="right" className="w-56 p-2">
                      <div className="space-y-1">
                        <p className="font-semibold text-xs mb-2 text-muted-foreground px-2">
                          {tNav("moreWorkspaces")}
                        </p>
                        {workspaces.map((workspace) => {
                          const isActive =
                            currentWorkspace?.id === workspace.id;
                          return (
                            <button
                              key={workspace.id}
                              onClick={() =>
                                setSelectedWorkspaceId(workspace.id)
                              }
                              className={cn(
                                "flex items-center gap-2 w-full text-left px-2 py-1.5 text-sm rounded transition-colors hover:bg-muted/50",
                                isActive
                                  ? "text-foreground font-medium"
                                  : "text-muted-foreground hover:text-foreground",
                              )}
                            >
                              <div
                                className={cn(
                                  "w-6 h-6 rounded-md flex items-center justify-center bg-linear-to-br text-white text-xs font-semibold shrink-0",
                                  getSeededAvatarGradient(workspace.id),
                                  !isActive && "opacity-60",
                                )}
                              >
                                {getInitials(workspace.name)}
                              </div>
                              <span className="flex-1 truncate">
                                {workspace.name}
                              </span>
                            </button>
                          );
                        })}
                        <Separator className="my-1" />
                        <button
                          onClick={() => setCreateWorkspaceOpen(true)}
                          className="flex items-center gap-2 w-full text-left px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground rounded transition-colors"
                        >
                          <div className="w-6 h-6 rounded-md flex items-center justify-center border border-dashed border-muted-foreground/40">
                            <Plus size={14} />
                          </div>
                          <span>{tNav("createWorkspace")}</span>
                        </button>
                      </div>
                    </PopoverContent>
                  </Popover>
                );
              })()
            ) : (
              visibleWorkspaces.map((workspace) => {
                const isSelected = currentWorkspace?.id === workspace.id;
                return (
                  <Tooltip key={workspace.id}>
                    <TooltipTrigger asChild>
                      <div
                        className={cn(
                          "cursor-pointer transition-all duration-200 flex items-center justify-center bg-linear-to-br text-white font-semibold",
                          getSeededAvatarGradient(workspace.id),
                          isSelected
                            ? "w-11 h-11 rounded-lg text-base shadow-[0_2px_12px_rgba(0,0,0,0.3)]"
                            : "w-9 h-9 rounded-full text-sm opacity-50 hover:opacity-90 hover:rounded-2xl hover:w-10 hover:h-10",
                        )}
                        onClick={() => setSelectedWorkspaceId(workspace.id)}
                      >
                        {getInitials(workspace.name)}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                      <p>{workspace.name}</p>
                    </TooltipContent>
                  </Tooltip>
                );
              })
            )}

            {/* Create Workspace Button - only when expanded */}
            {!sidebarCollapsed && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div
                    className="w-10 h-10 cursor-pointer hover:opacity-80 transition-all rounded-2xl hover:rounded-xl bg-nav-hover-strong hover:bg-nav-hover-stronger flex items-center justify-center text-nav-foreground border-2 border-dashed border-nav-border-muted"
                    onClick={() => setCreateWorkspaceOpen(true)}
                  >
                    <Plus size={18} />
                  </div>
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
          <div data-tauri-drag-region className="shrink-0 py-4">
            <Popover open={userMenuOpen} onOpenChange={setUserMenuOpen}>
              <PopoverTrigger asChild>
                <div className="relative cursor-pointer">
                  <UserAvatar
                    userId={currentUser?.id}
                    name={currentUser?.displayName}
                    username={currentUser?.username}
                    avatarUrl={currentUser?.avatarUrl}
                    className="w-10 h-10"
                    fallbackClassName="transition-opacity hover:opacity-90 text-sm font-medium"
                  />
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
                    <div className="relative">
                      <UserAvatar
                        userId={currentUser?.id}
                        name={currentUser?.displayName}
                        username={currentUser?.username}
                        avatarUrl={currentUser?.avatarUrl}
                        className="w-12 h-12 cursor-pointer"
                        fallbackClassName="text-lg font-medium"
                        onClick={devtoolsTap}
                      />
                      {devtoolsMessage && (
                        <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1 whitespace-nowrap rounded bg-foreground px-2 py-1 text-xs text-background shadow-md animate-in fade-in zoom-in-95 duration-150">
                          {devtoolsMessage}
                        </div>
                      )}
                    </div>
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
                </div>
                {/* Temporary: hide status actions and preferences from the user menu. */}
                <Separator />

                {/* Profile */}
                <div className="py-1">
                  <button
                    onClick={() => {
                      setUserMenuOpen(false);
                      navigate({ to: "/profile" as never });
                    }}
                    className="w-full flex items-center gap-3 px-4 py-2 text-sm hover:bg-accent"
                  >
                    <User size={16} />
                    <span>{tSettings("profile")}</span>
                  </button>
                </div>

                <Separator />

                {/* Language Switcher */}
                <div className="py-1">
                  <button
                    onClick={() => setLanguageMenuOpen((v) => !v)}
                    className="w-full flex items-center justify-between px-4 py-2 text-sm hover:bg-accent"
                  >
                    <div className="flex items-center gap-3">
                      {isLanguageLoading ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <Globe size={16} />
                      )}
                      <span>{tSettings("language")}</span>
                      <span className="text-muted-foreground">
                        {
                          supportedLanguages.find(
                            (l) => l.code === i18n.language,
                          )?.nativeName
                        }
                      </span>
                    </div>
                    <ChevronRight
                      size={14}
                      className={cn(
                        "text-muted-foreground transition-transform",
                        languageMenuOpen && "rotate-90",
                      )}
                    />
                  </button>
                  {languageMenuOpen && (
                    <div className="py-1">
                      {supportedLanguages.map((lang) => (
                        <button
                          key={lang.code}
                          onClick={() => changeLanguage(lang.code)}
                          disabled={isLanguageLoading}
                          className={cn(
                            "w-full flex items-center justify-between px-4 py-2 pl-10 text-sm hover:bg-accent disabled:opacity-50 disabled:pointer-events-none",
                            i18n.language === lang.code && "bg-accent",
                          )}
                        >
                          <span>{lang.nativeName}</span>
                          {i18n.language === lang.code && (
                            <span className="text-primary">✓</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <Separator />

                {/* Logout */}
                <div className="py-1">
                  <button
                    onClick={handleLogout}
                    disabled={isLoggingOut}
                    className="w-full flex items-center gap-3 px-4 py-2 text-sm hover:bg-accent text-destructive disabled:opacity-60 disabled:pointer-events-none"
                  >
                    {isLoggingOut ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <LogOut size={16} />
                    )}
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

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
  type SidebarSection,
} from "@/stores";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useCurrentUser, useLogout } from "@/hooks/useAuth";
import { useUpdateStatus, useOnlineUsers } from "@/hooks/useIMUsers";
import { useNotificationCounts } from "@/hooks/useNotifications";
import type { UserStatus } from "@/types/im";

// Navigation items with i18n keys
const navigationItems = [
  { id: "home", labelKey: "home" as const, icon: Home, path: "/" },
  {
    id: "messages",
    labelKey: "dms" as const,
    icon: MessageSquare,
    path: "/messages",
  },
  {
    id: "activity",
    labelKey: "activity" as const,
    icon: Bell,
    path: "/activity",
  },
  { id: "files", labelKey: "files" as const, icon: FileText, path: "/files" },
  {
    id: "more",
    labelKey: "more" as const,
    icon: MoreHorizontal,
    path: "/more",
  },
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
  const { data: currentUser } = useCurrentUser();
  const { mutate: logout } = useLogout();
  const { mutate: updateStatus } = useUpdateStatus();
  const { data: onlineUsers = {} } = useOnlineUsers();
  const { data: notificationCounts } = useNotificationCounts();

  const unreadCount = notificationCounts?.total ?? 0;

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
        return "bg-green-500";
      case "away":
        return "bg-yellow-500";
      case "busy":
        return "bg-red-500";
      default:
        return "bg-gray-400";
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
  const visibleWorkspaces = workspaces?.slice(0, 5) || [];
  const moreWorkspaces = workspaces?.slice(5) || [];
  const hasMoreWorkspaces = moreWorkspaces.length > 0;

  // Set first workspace as selected by default
  const currentWorkspace =
    workspaces?.find((w) => w.id === selectedWorkspaceId) || workspaces?.[0];

  // Initialize selectedWorkspaceId with the first workspace if not set
  useEffect(() => {
    if (workspaces && workspaces.length > 0 && !selectedWorkspaceId) {
      if (import.meta.env.DEV) {
        console.log("[MainSidebar] Initializing workspace:", workspaces[0].id);
      }
      setSelectedWorkspaceId(workspaces[0].id);
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
      // Note: Don't remove messages as they might be needed if user navigates back

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

  return (
    <TooltipProvider>
      <aside className="w-16 bg-[#3f1651] text-white flex flex-col items-center py-4 space-y-2">
        {/* Workspace Avatars */}
        <div className="mb-4 space-y-3">
          {isLoading ? (
            <Avatar className="w-10 h-10">
              <AvatarFallback className="bg-white text-[#3f1651] rounded-lg">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-[#3f1651]" />
              </AvatarFallback>
            </Avatar>
          ) : visibleWorkspaces.length === 0 ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Avatar className="w-10 h-10 cursor-pointer hover:opacity-80 transition-opacity">
                  <AvatarFallback className="bg-white text-[#3f1651] rounded-full font-bold text-base">
                    🏋
                  </AvatarFallback>
                </Avatar>
              </TooltipTrigger>
              <TooltipContent side="right">
                <p>{tNav("noWorkspace")}</p>
              </TooltipContent>
            </Tooltip>
          ) : (
            visibleWorkspaces.map((workspace, index) => (
              <Tooltip key={workspace.id}>
                <TooltipTrigger asChild>
                  <Avatar
                    className={cn(
                      "w-10 h-10 cursor-pointer transition-all",
                      currentWorkspace?.id === workspace.id
                        ? "ring-2 ring-white ring-offset-2 ring-offset-[#3f1651]"
                        : "hover:opacity-80",
                    )}
                    onClick={() => setSelectedWorkspaceId(workspace.id)}
                  >
                    <AvatarFallback
                      className={cn(
                        "rounded-full font-bold text-base text-white",
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

          {/* More Workspaces Button */}
          {hasMoreWorkspaces && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Avatar className="w-10 h-10 cursor-pointer hover:opacity-80 transition-opacity">
                  <AvatarFallback className="bg-white/20 text-white rounded-full">
                    <MoreVertical size={18} />
                  </AvatarFallback>
                </Avatar>
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-xs">
                <div className="space-y-1">
                  <p className="font-semibold text-xs mb-2 text-slate-700">
                    {tNav("moreWorkspaces")}
                  </p>
                  {moreWorkspaces.map((workspace, index) => {
                    const moreIndex = 5 + index; // Continue color sequence
                    return (
                      <button
                        key={workspace.id}
                        onClick={() => setSelectedWorkspaceId(workspace.id)}
                        className="flex items-center gap-2 w-full text-left px-2 py-1.5 text-sm hover:bg-purple-50 rounded transition-colors"
                      >
                        <div
                          className={cn(
                            "w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold",
                            getWorkspaceColor(moreIndex),
                          )}
                        >
                          {getInitials(workspace.name)}
                        </div>
                        <span className="text-slate-800">{workspace.name}</span>
                      </button>
                    );
                  })}
                </div>
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Navigation Items */}
        <nav className="flex-1 w-full flex flex-col items-center space-y-1">
          {navigationItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            const label = tNav(item.labelKey);
            const showBadge = item.id === "activity" && unreadCount > 0;

            return (
              <Button
                key={item.id}
                variant="ghost"
                size="icon"
                onClick={() => {
                  const section = item.id as SidebarSection;
                  appActions.setActiveSidebar(section);
                  // Navigate to the last visited path for this section
                  const targetPath = getLastVisitedPath(section);
                  navigate({ to: targetPath });
                }}
                className={cn(
                  "w-12 h-12 rounded-lg flex flex-col items-center justify-center gap-0.5 transition-all hover:bg-white/10 text-white/70 hover:text-white relative",
                  isActive && "bg-white/10 text-white",
                )}
                title={label}
              >
                <div className="relative">
                  <Icon size={20} />
                  {showBadge && (
                    <span className="absolute -top-1.5 -right-1.5 min-w-4 h-4 px-1 bg-red-500 text-white text-[10px] font-medium rounded-full flex items-center justify-center">
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                  )}
                </div>
                <span className="text-xs mt-1.5">{label}</span>
              </Button>
            );
          })}
        </nav>

        {/* User Avatar at Bottom */}
        <Popover open={userMenuOpen} onOpenChange={setUserMenuOpen}>
          <PopoverTrigger asChild>
            <div className="relative cursor-pointer">
              <Avatar className="w-10 h-10">
                <AvatarFallback className="bg-pink-600 hover:bg-pink-700 transition-colors text-white text-sm font-medium">
                  {currentUser?.displayName?.[0] ||
                    currentUser?.username?.[0]?.toUpperCase() ||
                    "U"}
                </AvatarFallback>
              </Avatar>
              <div
                className={cn(
                  "absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#3f1651]",
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
                  <AvatarFallback className="bg-pink-600 text-white text-lg font-medium">
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
              {supportedLanguages.map((lang) => (
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
                    <span className="text-purple-600">✓</span>
                  )}
                </button>
              ))}
            </div>

            <Separator />

            {/* Logout */}
            <div className="py-1">
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-4 py-2 text-sm hover:bg-accent text-red-600"
              >
                <LogOut size={16} />
                <span>
                  {tAuth("signOutFrom", { workspace: currentWorkspaceName })}
                </span>
              </button>
            </div>
          </PopoverContent>
        </Popover>
      </aside>
    </TooltipProvider>
  );
}

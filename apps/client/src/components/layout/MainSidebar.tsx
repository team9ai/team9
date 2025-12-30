import {
  Home,
  MessageSquare,
  Activity,
  FileText,
  MoreHorizontal,
  MoreVertical,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useNavigate, useLocation } from "@tanstack/react-router";
import { useUserWorkspaces } from "@/hooks/useWorkspace";
import { useState } from "react";

const navigationItems = [
  { id: "home", label: "Home", icon: Home, path: "/" },
  { id: "messages", label: "DMs", icon: MessageSquare, path: "/messages" },
  { id: "activity", label: "Activity", icon: Activity, path: "/activity" },
  { id: "files", label: "Files", icon: FileText, path: "/files" },
  { id: "more", label: "More", icon: MoreHorizontal, path: "/more" },
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
  const navigate = useNavigate();
  const location = useLocation();
  const { data: workspaces, isLoading } = useUserWorkspaces();
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<
    string | undefined
  >(undefined);

  // Get first 5 workspaces and remaining ones
  const visibleWorkspaces = workspaces?.slice(0, 5) || [];
  const moreWorkspaces = workspaces?.slice(5) || [];
  const hasMoreWorkspaces = moreWorkspaces.length > 0;

  // Set first workspace as selected by default
  const currentWorkspace =
    workspaces?.find((w) => w.id === selectedWorkspaceId) || workspaces?.[0];

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
                <p>No Workspace</p>
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
                    More Workspaces
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

            return (
              <Button
                key={item.id}
                variant="ghost"
                size="icon"
                onClick={() => navigate({ to: item.path })}
                className={cn(
                  "w-12 h-12 rounded-lg flex flex-col items-center justify-center gap-0.5 transition-all hover:bg-white/10 text-white/70 hover:text-white",
                  isActive && "bg-white/10 text-white",
                )}
                title={item.label}
              >
                <Icon size={20} />
                <span className="text-[9px]">{item.label}</span>
              </Button>
            );
          })}
        </nav>

        {/* User Avatar at Bottom */}
        <Avatar className="w-10 h-10 cursor-pointer relative">
          <AvatarFallback className="bg-pink-600 hover:bg-pink-700 transition-colors text-white text-sm font-medium">
            U
          </AvatarFallback>
          <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-[#3f1651]" />
        </Avatar>
      </aside>
    </TooltipProvider>
  );
}

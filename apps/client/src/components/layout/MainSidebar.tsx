import {
  Home,
  MessageSquare,
  Activity,
  FileText,
  MoreHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useNavigate, useLocation } from "@tanstack/react-router";

const navigationItems = [
  { id: "home", label: "Home", icon: Home, path: "/" },
  { id: "messages", label: "DMs", icon: MessageSquare, path: "/messages" },
  { id: "activity", label: "Activity", icon: Activity, path: "/activity" },
  { id: "files", label: "Files", icon: FileText, path: "/files" },
  { id: "more", label: "More", icon: MoreHorizontal, path: "/more" },
];

export function MainSidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <aside className="w-16 bg-[#3f1651] text-white flex flex-col items-center py-4 space-y-2">
      {/* Workspace Avatar */}
      <Avatar className="w-10 h-10 mb-4 cursor-pointer hover:bg-white/10 transition-colors">
        <AvatarFallback className="bg-white text-[#3f1651] rounded-lg font-bold text-base">
          🏋
        </AvatarFallback>
      </Avatar>

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
  );
}

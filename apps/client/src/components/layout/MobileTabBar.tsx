import {
  Home,
  MessageSquare,
  Activity,
  FileText,
  MoreHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useNavigate, useLocation } from "@tanstack/react-router";

const tabItems = [
  { id: "home", label: "Home", icon: Home, path: "/" },
  { id: "messages", label: "DMs", icon: MessageSquare, path: "/messages" },
  { id: "activity", label: "Activity", icon: Activity, path: "/activity" },
  { id: "files", label: "Files", icon: FileText, path: "/files" },
  { id: "more", label: "More", icon: MoreHorizontal, path: "/more" },
];

export function MobileTabBar() {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-lg border-t border-border dark:bg-sidebar/80 dark:border-sidebar-border safe-area-inset-bottom">
      <div className="flex items-center justify-around h-16 px-2">
        {tabItems.map((item) => {
          const Icon = item.icon;
          const isActive = location.pathname === item.path;

          return (
            <button
              key={item.id}
              onClick={() => navigate({ to: item.path })}
              className={cn(
                "flex flex-col items-center justify-center gap-1 flex-1 h-full rounded-lg transition-colors",
                "active:bg-accent/50",
                isActive ? "text-primary" : "text-muted-foreground",
              )}
              aria-label={item.label}
              aria-current={isActive ? "page" : undefined}
            >
              <Icon size={24} strokeWidth={isActive ? 2.5 : 2} />
              <span
                className={cn(
                  "text-xs font-medium",
                  isActive && "font-semibold",
                )}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

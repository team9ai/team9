import {
  Home,
  MessageSquare,
  Activity,
  FileText,
  MoreHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface MobileTabBarProps {
  activeSection: string;
  onSectionChange: (section: string) => void;
}

const tabItems = [
  { id: "home", label: "主页", icon: Home },
  { id: "messages", label: "私信", icon: MessageSquare },
  { id: "activity", label: "活动", icon: Activity },
  { id: "files", label: "文件", icon: FileText },
  { id: "more", label: "更多", icon: MoreHorizontal },
];

export function MobileTabBar({
  activeSection,
  onSectionChange,
}: MobileTabBarProps) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-lg border-t border-border dark:bg-sidebar/80 dark:border-sidebar-border safe-area-inset-bottom">
      <div className="flex items-center justify-around h-16 px-2">
        {tabItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeSection === item.id;

          return (
            <button
              key={item.id}
              onClick={() => onSectionChange(item.id)}
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

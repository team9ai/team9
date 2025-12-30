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

interface MainSidebarProps {
  activeSection: string;
  onSectionChange: (section: string) => void;
}

const navigationItems = [
  { id: "home", label: "主页", icon: Home },
  { id: "messages", label: "私信", icon: MessageSquare },
  { id: "activity", label: "活动", icon: Activity },
  { id: "files", label: "文件", icon: FileText },
  { id: "more", label: "更多", icon: MoreHorizontal },
];

export function MainSidebar({
  activeSection,
  onSectionChange,
}: MainSidebarProps) {
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
          const isActive = activeSection === item.id;

          return (
            <Button
              key={item.id}
              variant="ghost"
              size="icon"
              onClick={() => onSectionChange(item.id)}
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

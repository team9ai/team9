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
  { id: "workspace", label: "Workspace", icon: Home },
  { id: "home", label: "Home", icon: Home },
  { id: "messages", label: "DMs", icon: MessageSquare },
  { id: "activity", label: "Activity", icon: Activity },
  { id: "files", label: "Files", icon: FileText },
  { id: "more", label: "More", icon: MoreHorizontal },
];

export function MainSidebar({
  activeSection,
  onSectionChange,
}: MainSidebarProps) {
  return (
    <aside className="w-16 bg-linear-to-b from-indigo-600 to-blue-700 text-white flex flex-col items-center py-4 space-y-2 shadow-lg">
      {/* Workspace Avatar */}
      <Avatar className="w-10 h-10 mb-4 cursor-pointer hover:bg-indigo-50 transition-colors shadow-sm">
        <AvatarFallback className="bg-white text-indigo-600 rounded-lg font-bold text-lg">
          T9
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
                "w-12 h-12 rounded-lg flex flex-col items-center justify-center gap-0.5 transition-all hover:bg-white/20 text-white",
                isActive && "bg-white/30 shadow-sm",
              )}
              title={item.label}
            >
              <Icon size={20} />
              <span className="text-[10px]">{item.label}</span>
            </Button>
          );
        })}
      </nav>

      {/* User Avatar at Bottom */}
      <Avatar className="w-10 h-10 cursor-pointer">
        <AvatarFallback className="bg-white/20 hover:bg-white/30 transition-colors text-white text-sm font-medium">
          U
        </AvatarFallback>
      </Avatar>
    </aside>
  );
}

import { Search, Plus, ChevronDown, Hash, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

interface SubSidebarProps {
  activeSection: string;
}

// Different content based on active section
const sectionContent = {
  workspace: {
    title: "Team9 Workspace",
    items: [
      { id: "channels", label: "Channels", type: "category" },
      { id: "general", label: "general", icon: Hash, isChannel: true },
      { id: "random", label: "random", icon: Hash, isChannel: true },
      { id: "dev-team", label: "dev-team", icon: Lock, isChannel: true },
    ],
  },
  home: {
    title: "Home",
    items: [
      { id: "threads", label: "Threads", type: "item" },
      { id: "drafts", label: "Drafts & Sent", type: "item" },
      { id: "bookmarks", label: "Bookmarks", type: "item" },
      { id: "mentions", label: "Mentions & reactions", type: "item" },
    ],
  },
  messages: {
    title: "Direct Messages",
    items: [
      { id: "dm-1", label: "Alice Johnson", type: "item" },
      { id: "dm-2", label: "Bob Smith", type: "item" },
      { id: "dm-3", label: "Carol White", type: "item" },
    ],
  },
  activity: {
    title: "Activity",
    items: [
      { id: "all", label: "All activity", type: "item" },
      { id: "mentions", label: "Mentions", type: "item" },
      { id: "threads", label: "Threads", type: "item" },
    ],
  },
  files: {
    title: "Files",
    items: [
      { id: "all-files", label: "All files", type: "item" },
      { id: "images", label: "Images", type: "item" },
      { id: "documents", label: "Documents", type: "item" },
    ],
  },
  more: {
    title: "More",
    items: [
      { id: "settings", label: "Settings", type: "item" },
      { id: "help", label: "Help", type: "item" },
      { id: "about", label: "About", type: "item" },
    ],
  },
};

export function SubSidebar({ activeSection }: SubSidebarProps) {
  const content =
    sectionContent[activeSection as keyof typeof sectionContent] ||
    sectionContent.home;

  return (
    <aside className="w-64 bg-slate-50 border-r border-slate-200 flex flex-col">
      {/* Header */}
      <div className="p-4">
        <Button
          variant="ghost"
          className="w-full justify-between text-slate-900 hover:bg-slate-100 px-2 h-auto py-1.5"
        >
          <span className="font-semibold">{content.title}</span>
          <ChevronDown size={16} className="text-slate-600" />
        </Button>
      </div>

      <Separator />

      {/* Search Bar */}
      <div className="p-3">
        <div className="relative">
          <Search
            size={16}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 z-10"
          />
          <Input
            type="text"
            placeholder="Search..."
            className="pl-8 h-9 bg-white"
          />
        </div>
      </div>

      {/* Content Items */}
      <ScrollArea className="flex-1 px-3">
        <nav className="space-y-0.5 pb-3">
          {content.items.map((item) => {
            if (item.type === "category") {
              return (
                <Button
                  key={item.id}
                  variant="ghost"
                  className="w-full justify-between px-2 h-auto py-1.5 text-sm text-slate-600 hover:text-slate-900 hover:bg-transparent"
                >
                  <div className="flex items-center gap-1">
                    <ChevronDown size={14} />
                    <span>{item.label}</span>
                  </div>
                  <Plus size={14} className="hover:text-indigo-600" />
                </Button>
              );
            }

            const Icon = (item as any).icon;

            return (
              <Button
                key={item.id}
                variant="ghost"
                className={cn(
                  "w-full justify-start gap-2 px-2 h-auto py-1.5 text-sm text-slate-700 hover:bg-indigo-50 hover:text-indigo-700",
                )}
              >
                {Icon && <Icon size={16} />}
                <span className="truncate">{item.label}</span>
              </Button>
            );
          })}
        </nav>
      </ScrollArea>

      <Separator />

      {/* Add Button */}
      <div className="p-3">
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 px-2 h-auto py-1.5 text-sm text-slate-700 hover:bg-indigo-50 hover:text-indigo-700"
        >
          <Plus size={16} />
          <span>Add {activeSection === "messages" ? "teammate" : "item"}</span>
        </Button>
      </div>
    </aside>
  );
}

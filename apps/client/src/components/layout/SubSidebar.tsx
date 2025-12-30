import {
  Search,
  Plus,
  ChevronDown,
  ChevronRight,
  Hash,
  Lock,
  Headphones,
  BookOpen,
  Star,
  Users,
  Grid,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useState } from "react";

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
    title: "Weight Watch",
    items: [
      { id: "huddle", label: "Huddle", icon: Headphones, type: "item" },
      { id: "directory", label: "Directory", icon: BookOpen, type: "item" },
      {
        id: "starred",
        label: "Starred",
        icon: Star,
        type: "item",
        description: "Drag important items here",
      },
      { id: "channels", label: "Channels", type: "collapsible" },
      { id: "dms", label: "Direct Messages", type: "collapsible" },
      { id: "apps", label: "Apps", type: "collapsible" },
    ],
    channels: [
      { id: "revenues", label: "revenues", icon: Hash },
      { id: "sentry", label: "sentry", icon: Lock },
      { id: "featupvote", label: "featupvote", icon: Plus, isAdd: true },
      { id: "incidents", label: "incidents", icon: Plus, isAdd: true },
    ],
    dms: [
      { id: "hh-huang", name: "hh huang", avatar: "H", status: "online" },
      { id: "jing", name: "Jing", avatar: "J", status: "online" },
      { id: "tsukina", name: "tsukina", avatar: "T", status: "online" },
      { id: "jerry-l", name: "Jerry L", avatar: "J", status: "online" },
      {
        id: "yingmeng-wang",
        name: "Yingmeng Wang",
        avatar: "Y",
        status: "online",
      },
      {
        id: "wangbaochuan",
        name: "wangbaochuan",
        avatar: "W",
        status: "offline",
      },
      { id: "sutong", name: "sutong", avatar: "S", status: "offline" },
      { id: "chenyikai", name: "chenyikai", avatar: "C", status: "offline" },
      {
        id: "xiexuecheng",
        name: "xiexuecheng",
        avatar: "X",
        status: "offline",
      },
      { id: "liujiawei", name: "liujiawei", avatar: "L", status: "offline" },
      { id: "jt", name: "JT You", avatar: "J", status: "online" },
    ],
    apps: [],
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
  const [channelsExpanded, setChannelsExpanded] = useState(true);
  const [dmsExpanded, setDmsExpanded] = useState(true);
  const [appsExpanded, setAppsExpanded] = useState(true);

  const content =
    sectionContent[activeSection as keyof typeof sectionContent] ||
    sectionContent.home;

  // For home section, we have special rendering
  const isHomeSection = activeSection === "home";

  return (
    <aside className="w-64 bg-[#5b2c6f] text-white flex flex-col">
      {/* Header */}
      <div className="p-4">
        <Button
          variant="ghost"
          className="w-full justify-between text-white hover:bg-white/10 px-2 h-auto py-1.5"
        >
          <span className="font-semibold text-lg">{content.title}</span>
          <ChevronDown size={16} className="text-white/70" />
        </Button>
      </div>

      {/* Search Bar */}
      <div className="px-3 pb-3">
        <div className="relative">
          <Search
            size={16}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-white/50 z-10"
          />
          <Input
            type="text"
            placeholder="Search..."
            className="pl-8 h-9 bg-white/10 border-white/20 text-white placeholder:text-white/50 focus:bg-white/15"
          />
        </div>
      </div>

      <Separator className="bg-white/10" />

      {/* Content Items */}
      <ScrollArea className="flex-1 px-3">
        <nav className="space-y-0.5 pb-3 pt-2">
          {isHomeSection ? (
            <>
              {/* Top-level navigation items */}
              {content.items.map((item: any) => {
                if (item.type === "collapsible") {
                  // Render collapsible sections
                  if (item.id === "channels") {
                    return (
                      <div key={item.id} className="mt-4">
                        <Button
                          variant="ghost"
                          onClick={() => setChannelsExpanded(!channelsExpanded)}
                          className="w-full justify-start gap-1 px-2 h-auto py-1.5 text-sm text-white/90 hover:text-white hover:bg-white/10"
                        >
                          {channelsExpanded ? (
                            <ChevronDown size={14} />
                          ) : (
                            <ChevronRight size={14} />
                          )}
                          <span>{item.label}</span>
                        </Button>
                        {channelsExpanded && (
                          <div className="ml-4 mt-1 space-y-0.5">
                            {(content as any).channels?.map((channel: any) => {
                              const ChannelIcon = channel.icon;
                              return (
                                <Button
                                  key={channel.id}
                                  variant="ghost"
                                  className={cn(
                                    "w-full justify-start gap-2 px-2 h-auto py-1.5 text-sm text-white/80 hover:bg-white/10 hover:text-white",
                                    channel.isAdd && "text-white/50",
                                  )}
                                >
                                  {ChannelIcon && <ChannelIcon size={16} />}
                                  <span className="truncate">
                                    {channel.label}
                                  </span>
                                </Button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  } else if (item.id === "dms") {
                    return (
                      <div key={item.id} className="mt-4">
                        <Button
                          variant="ghost"
                          onClick={() => setDmsExpanded(!dmsExpanded)}
                          className="w-full justify-start gap-1 px-2 h-auto py-1.5 text-sm text-white/90 hover:text-white hover:bg-white/10"
                        >
                          {dmsExpanded ? (
                            <ChevronDown size={14} />
                          ) : (
                            <ChevronRight size={14} />
                          )}
                          <span>{item.label}</span>
                        </Button>
                        {dmsExpanded && (
                          <div className="ml-2 mt-1 space-y-0.5">
                            {(content as any).dms?.map((dm: any) => (
                              <Button
                                key={dm.id}
                                variant="ghost"
                                className="w-full justify-start gap-2 px-2 h-auto py-2 text-sm text-white/80 hover:bg-white/10 hover:text-white"
                              >
                                <div className="relative">
                                  <Avatar className="w-6 h-6">
                                    <AvatarFallback className="bg-purple-400 text-white text-xs">
                                      {dm.avatar}
                                    </AvatarFallback>
                                  </Avatar>
                                  {dm.status === "online" && (
                                    <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-[#5b2c6f]" />
                                  )}
                                </div>
                                <span className="truncate">{dm.name}</span>
                              </Button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  } else if (item.id === "apps") {
                    return (
                      <div key={item.id} className="mt-4">
                        <Button
                          variant="ghost"
                          onClick={() => setAppsExpanded(!appsExpanded)}
                          className="w-full justify-start gap-1 px-2 h-auto py-1.5 text-sm text-white/90 hover:text-white hover:bg-white/10"
                        >
                          {appsExpanded ? (
                            <ChevronDown size={14} />
                          ) : (
                            <ChevronRight size={14} />
                          )}
                          <span>{item.label}</span>
                        </Button>
                      </div>
                    );
                  }
                }

                // Regular items
                const Icon = item.icon;
                return (
                  <div key={item.id}>
                    <Button
                      variant="ghost"
                      className="w-full justify-start gap-2 px-2 h-auto py-1.5 text-sm text-white/80 hover:bg-white/10 hover:text-white"
                    >
                      {Icon && <Icon size={16} />}
                      <span className="truncate">{item.label}</span>
                    </Button>
                    {item.description && (
                      <p className="px-2 text-xs text-white/50 mt-1 mb-2">
                        {item.description}
                      </p>
                    )}
                  </div>
                );
              })}
            </>
          ) : (
            // Default rendering for other sections
            <>
              {content.items.map((item: any) => {
                if (item.type === "category") {
                  return (
                    <Button
                      key={item.id}
                      variant="ghost"
                      className="w-full justify-between px-2 h-auto py-1.5 text-sm text-white/70 hover:text-white hover:bg-white/10"
                    >
                      <div className="flex items-center gap-1">
                        <ChevronDown size={14} />
                        <span>{item.label}</span>
                      </div>
                      <Plus size={14} className="hover:text-purple-300" />
                    </Button>
                  );
                }

                const Icon = (item as any).icon;

                return (
                  <Button
                    key={item.id}
                    variant="ghost"
                    className={cn(
                      "w-full justify-start gap-2 px-2 h-auto py-1.5 text-sm text-white/80 hover:bg-white/10 hover:text-white",
                    )}
                  >
                    {Icon && <Icon size={16} />}
                    <span className="truncate">{item.label}</span>
                  </Button>
                );
              })}
            </>
          )}
        </nav>
      </ScrollArea>

      {/* Add Button */}
      <div className="p-3 border-t border-white/10">
        <Button
          variant="ghost"
          className="w-full justify-center gap-2 px-2 h-10 text-sm text-white/90 hover:bg-white/10 hover:text-white rounded-full border border-white/20"
        >
          <Plus size={18} />
        </Button>
      </div>
    </aside>
  );
}

import {
  Search,
  ChevronDown,
  ChevronRight,
  Hash,
  Lock,
  Headphones,
  BookOpen,
  Star,
  Plus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useState } from "react";
import { useChannelsByType } from "@/hooks/useChannels";
import { useOnlineUsers } from "@/hooks/useIMUsers";
import { Link, useParams } from "@tanstack/react-router";
import { NewMessageDialog } from "@/components/dialog/NewMessageDialog";
import { CreateChannelDialog } from "@/components/dialog/CreateChannelDialog";

const topItems = [
  { id: "huddle", label: "Huddle", icon: Headphones },
  { id: "directory", label: "Directory", icon: BookOpen },
  {
    id: "starred",
    label: "Starred",
    icon: Star,
    description: "Drag important items here",
  },
];

export function HomeSubSidebar() {
  const [channelsExpanded, setChannelsExpanded] = useState(true);
  const [dmsExpanded, setDmsExpanded] = useState(true);
  const [appsExpanded, setAppsExpanded] = useState(true);
  const [isNewMessageOpen, setIsNewMessageOpen] = useState(false);
  const [isCreateChannelOpen, setIsCreateChannelOpen] = useState(false);

  const {
    publicChannels = [],
    privateChannels = [],
    directChannels = [],
    isLoading,
  } = useChannelsByType();
  const { data: onlineUsers = {} } = useOnlineUsers();
  const params = useParams({ strict: false });
  const selectedChannelId = (params as { channelId?: string }).channelId;

  const allChannels = [...publicChannels, ...privateChannels];

  // Extract users from direct channels
  const directMessageUsers = directChannels.map((channel) => {
    // Use the otherUser info from the channel if available
    const otherUser = channel.otherUser;
    const displayName =
      otherUser?.displayName || otherUser?.username || "Direct Message";
    const avatarText =
      otherUser?.displayName?.[0] || otherUser?.username?.[0] || "D";

    return {
      id: channel.id,
      channelId: channel.id,
      userId: otherUser?.id,
      name: displayName,
      avatar: avatarText,
      avatarUrl: otherUser?.avatarUrl,
      status: otherUser?.status || ("offline" as const),
      unreadCount: channel.unreadCount || 0,
    };
  });

  return (
    <aside className="w-64 bg-[#5b2c6f] text-white flex flex-col">
      {/* Header */}
      <div className="p-4">
        <Button
          variant="ghost"
          className="w-full justify-between text-white hover:bg-white/10 px-2 h-auto py-1.5"
        >
          <span className="font-semibold text-lg">Weight Watch</span>
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
          {/* Top-level navigation items */}
          {topItems.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.id}>
                <Button
                  variant="ghost"
                  className="w-full justify-start gap-2 px-2 h-auto py-1.5 text-sm text-white/80 hover:bg-white/10 hover:text-white"
                >
                  <Icon size={16} />
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

          {/* Channels Section */}
          <div className="mt-4">
            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                onClick={() => setChannelsExpanded(!channelsExpanded)}
                className="flex-1 justify-start gap-1 px-2 h-auto py-1.5 text-sm text-white/90 hover:text-white hover:bg-white/10"
              >
                {channelsExpanded ? (
                  <ChevronDown size={14} />
                ) : (
                  <ChevronRight size={14} />
                )}
                <span>Channels</span>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-white/70 hover:text-white hover:bg-white/10"
                onClick={() => setIsCreateChannelOpen(true)}
                title="Add channel"
              >
                <Plus size={14} />
              </Button>
            </div>
            {channelsExpanded && (
              <div className="ml-4 mt-1 space-y-0.5">
                {isLoading ? (
                  <p className="text-xs text-white/50 px-2 py-1">Loading...</p>
                ) : allChannels.length === 0 ? (
                  <p className="text-xs text-white/50 px-2 py-1">No channels</p>
                ) : (
                  allChannels.map((channel) => {
                    const ChannelIcon =
                      channel.type === "private" ? Lock : Hash;
                    return (
                      <Link
                        key={channel.id}
                        to="/channels/$channelId"
                        params={{ channelId: channel.id }}
                      >
                        <Button
                          variant="ghost"
                          className={cn(
                            "w-full justify-start gap-2 px-2 h-auto py-1.5 text-sm text-white/80 hover:bg-white/10 hover:text-white",
                          )}
                        >
                          <ChannelIcon size={16} />
                          <span className="truncate flex-1 text-left">
                            {channel.name}
                          </span>
                          {channel.unreadCount > 0 && (
                            <span className="bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5 min-w-5 text-center">
                              {channel.unreadCount}
                            </span>
                          )}
                        </Button>
                      </Link>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* DMs Section */}
          <div className="mt-4">
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
              <span>Direct Messages</span>
            </Button>
            {dmsExpanded && (
              <div className="ml-2 mt-1 space-y-0.5">
                {isLoading ? (
                  <p className="text-xs text-white/50 px-2 py-1">Loading...</p>
                ) : directMessageUsers.length === 0 ? (
                  <p className="text-xs text-white/50 px-2 py-1">No messages</p>
                ) : (
                  directMessageUsers.map((dm) => {
                    const isOnline = dm.userId
                      ? dm.userId in onlineUsers
                      : false;
                    const isSelected = selectedChannelId === dm.channelId;
                    return (
                      <Link
                        key={dm.id}
                        to="/channels/$channelId"
                        params={{ channelId: dm.channelId }}
                      >
                        <Button
                          variant="ghost"
                          className={cn(
                            "w-full justify-start gap-2 px-2 h-auto py-2 text-sm text-white/80 hover:bg-white/10 hover:text-white",
                            isSelected && "bg-white/10 text-white",
                          )}
                        >
                          <div className="relative">
                            <Avatar className="w-6 h-6">
                              {dm.avatarUrl && (
                                <AvatarImage src={dm.avatarUrl} alt={dm.name} />
                              )}
                              <AvatarFallback className="bg-purple-400 text-white text-xs">
                                {dm.avatar}
                              </AvatarFallback>
                            </Avatar>
                            {isOnline && (
                              <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-[#5b2c6f]" />
                            )}
                          </div>
                          <span className="truncate flex-1 text-left">
                            {dm.name}
                          </span>
                          {dm.unreadCount > 0 && (
                            <span className="bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5 min-w-5 text-center">
                              {dm.unreadCount}
                            </span>
                          )}
                        </Button>
                      </Link>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* Apps Section */}
          <div className="mt-4">
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
              <span>Apps</span>
            </Button>
          </div>
        </nav>
      </ScrollArea>

      {/* Add Button */}
      <div className="p-3 border-t border-white/10">
        <Button
          variant="ghost"
          onClick={() => setIsNewMessageOpen(true)}
          className="w-full justify-center gap-2 px-2 h-10 text-sm text-white/90 hover:bg-white/10 hover:text-white rounded-full border border-white/20"
          title="New Message"
        >
          <Plus size={18} />
        </Button>
      </div>

      {/* New Message Dialog */}
      <NewMessageDialog
        isOpen={isNewMessageOpen}
        onClose={() => setIsNewMessageOpen(false)}
      />

      {/* Create Channel Dialog */}
      <CreateChannelDialog
        isOpen={isCreateChannelOpen}
        onClose={() => setIsCreateChannelOpen(false)}
      />
    </aside>
  );
}

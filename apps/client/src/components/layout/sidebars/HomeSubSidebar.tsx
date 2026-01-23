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
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import { useChannelsByType, usePublicChannels } from "@/hooks/useChannels";
import { useOnlineUsers } from "@/hooks/useIMUsers";
import { Link, useParams } from "@tanstack/react-router";
import { NewMessageDialog } from "@/components/dialog/NewMessageDialog";
import { CreateChannelDialog } from "@/components/dialog/CreateChannelDialog";
import { UserListItem } from "@/components/sidebar/UserListItem";

const topItems: {
  id: string;
  labelKey: "huddle" | "directory" | "starred";
  icon: typeof Headphones;
  descriptionKey?: "starredDescription";
}[] = [
  { id: "huddle", labelKey: "huddle", icon: Headphones },
  { id: "directory", labelKey: "directory", icon: BookOpen },
  {
    id: "starred",
    labelKey: "starred",
    icon: Star,
    descriptionKey: "starredDescription",
  },
];

export function HomeSubSidebar() {
  const { t: tNav } = useTranslation("navigation");
  const { t: tCommon } = useTranslation("common");
  const { t: tChannel } = useTranslation("channel");
  const { t: tMessage } = useTranslation("message");

  const [channelsExpanded, setChannelsExpanded] = useState(true);
  const [dmsExpanded, setDmsExpanded] = useState(true);
  const [appsExpanded, setAppsExpanded] = useState(true);
  const [isNewMessageOpen, setIsNewMessageOpen] = useState(false);
  const [isCreateChannelOpen, setIsCreateChannelOpen] = useState(false);

  const {
    publicChannels: myPublicChannels = [],
    privateChannels = [],
    directChannels = [],
    isLoading,
  } = useChannelsByType();
  const { data: allPublicChannels = [], isLoading: isLoadingPublic } =
    usePublicChannels();
  const { data: onlineUsers = {} } = useOnlineUsers();
  const params = useParams({ strict: false });
  const selectedChannelId = (params as { channelId?: string }).channelId;

  // Merge my public channels (with unread counts) with all public channels
  // Show all public channels, but use the unreadCount from myPublicChannels if available
  const publicChannelsWithStatus = allPublicChannels.map((channel) => {
    const myChannel = myPublicChannels.find((ch) => ch.id === channel.id);
    return {
      ...channel,
      unreadCount: myChannel?.unreadCount || 0,
    };
  });

  const allChannels = [...publicChannelsWithStatus, ...privateChannels];

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
    <aside className="w-64 h-full overflow-hidden bg-[#5b2c6f] text-white flex flex-col">
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
            placeholder={tCommon("searchPlaceholder")}
            className="pl-8 h-9 bg-white/10 border-white/20 text-white placeholder:text-white/50 focus:bg-white/15"
          />
        </div>
      </div>

      <Separator className="bg-white/10" />

      {/* Content Items */}
      <ScrollArea className="flex-1 min-h-0 px-3 [&>[data-slot=scroll-area-viewport]>div]:block!">
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
                  <span className="truncate">{tNav(item.labelKey)}</span>
                </Button>
                {item.descriptionKey && (
                  <p className="px-2 text-xs text-white/50 mt-1 mb-2">
                    {tNav(item.descriptionKey)}
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
                <span>{tNav("channels")}</span>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0 text-white/70 hover:text-white hover:bg-white/10"
                onClick={() => setIsCreateChannelOpen(true)}
                title={tNav("addChannel")}
              >
                <Plus size={14} />
              </Button>
            </div>
            {channelsExpanded && (
              <div className="ml-4 mt-1 space-y-0.5">
                {isLoading || isLoadingPublic ? (
                  <p className="text-xs text-white/50 px-2 py-1">
                    {tCommon("loading")}
                  </p>
                ) : allChannels.length === 0 ? (
                  <p className="text-xs text-white/50 px-2 py-1">
                    {tChannel("noChannels")}
                  </p>
                ) : (
                  allChannels.map((channel) => {
                    const ChannelIcon =
                      channel.type === "private" ? Lock : Hash;
                    const isMember =
                      "isMember" in channel ? channel.isMember : true;
                    return (
                      <Link
                        key={channel.id}
                        to="/channels/$channelId"
                        params={{ channelId: channel.id }}
                        className="block min-w-0"
                      >
                        <Button
                          variant="ghost"
                          className={cn(
                            "w-full min-w-0 justify-start gap-2 px-2 h-auto py-1.5 text-sm hover:bg-white/10 hover:text-white",
                            isMember ? "text-white/80" : "text-white/50 italic",
                          )}
                        >
                          <ChannelIcon
                            size={16}
                            className={cn(
                              "shrink-0",
                              !isMember && "opacity-50",
                            )}
                          />
                          <span
                            className="truncate text-left max-w-35"
                            title={channel.name}
                          >
                            {channel.name}
                          </span>
                          {channel.unreadCount > 0 && (
                            <Badge
                              variant="notification"
                              size="sm"
                              count={channel.unreadCount}
                            />
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
              <span>{tNav("directMessages")}</span>
            </Button>
            {dmsExpanded && (
              <div className="ml-2 mt-1 space-y-0.5">
                {isLoading ? (
                  <p className="text-xs text-white/50 px-2 py-1">
                    {tCommon("loading")}
                  </p>
                ) : directMessageUsers.length === 0 ? (
                  <p className="text-xs text-white/50 px-2 py-1">
                    {tMessage("noMessages")}
                  </p>
                ) : (
                  directMessageUsers.map((dm) => (
                    <UserListItem
                      key={dm.id}
                      name={dm.name}
                      avatar={dm.avatar}
                      avatarUrl={dm.avatarUrl}
                      isOnline={dm.userId ? dm.userId in onlineUsers : false}
                      isSelected={selectedChannelId === dm.channelId}
                      unreadCount={dm.unreadCount}
                      channelId={dm.channelId}
                      avatarSize="sm"
                    />
                  ))
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
              <span>{tNav("apps")}</span>
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
          title={tNav("newMessage")}
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

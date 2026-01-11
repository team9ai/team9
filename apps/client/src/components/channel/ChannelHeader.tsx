import { useState } from "react";
import { Hash, Lock, Phone, Video, Search, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ChannelSettingsSheet } from "./ChannelSettingsSheet";
import type { Channel, ChannelWithUnread, MemberRole } from "@/types/im";

interface ChannelHeaderProps {
  channel: Channel | ChannelWithUnread;
  currentUserRole?: MemberRole;
}

export function ChannelHeader({
  channel,
  currentUserRole,
}: ChannelHeaderProps) {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const ChannelIcon = channel.type === "private" ? Lock : Hash;

  // For direct messages, show the other user's info
  const isDirect = channel.type === "direct";
  const channelWithUnread = channel as ChannelWithUnread;
  const otherUser =
    "otherUser" in channelWithUnread ? channelWithUnread.otherUser : undefined;

  const displayName = isDirect
    ? otherUser?.displayName || otherUser?.username || "Unknown User"
    : channel.name;

  const getInitials = (name: string) => {
    return name[0]?.toUpperCase() || "U";
  };

  const isOnline = otherUser?.status === "online";

  return (
    <>
      <div className="h-14 px-4 flex items-center justify-between border-b">
        <div className="flex items-center gap-3">
          {isDirect && otherUser ? (
            <div className="relative">
              <Avatar className="w-8 h-8">
                <AvatarFallback className="bg-purple-400 text-white text-sm">
                  {getInitials(displayName)}
                </AvatarFallback>
              </Avatar>
              {isOnline && (
                <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-white" />
              )}
            </div>
          ) : (
            <ChannelIcon size={20} className="text-muted-foreground" />
          )}
          <div className="flex flex-col">
            <h2 className="font-semibold">{displayName}</h2>
            {isDirect && otherUser?.username && otherUser.displayName && (
              <p className="text-xs text-muted-foreground">
                @{otherUser.username}
              </p>
            )}
            {!isDirect && channel.description && (
              <p className="text-xs text-muted-foreground">
                {channel.description}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon">
            <Phone size={18} />
          </Button>
          <Button variant="ghost" size="icon">
            <Video size={18} />
          </Button>
          <Button variant="ghost" size="icon">
            <Search size={18} />
          </Button>
          {!isDirect && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsSettingsOpen(true)}
            >
              <Info size={18} />
            </Button>
          )}
        </div>
      </div>

      {/* Channel Settings Sheet */}
      {!isDirect && (
        <ChannelSettingsSheet
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          channelId={channel.id}
          currentUserRole={currentUserRole}
        />
      )}
    </>
  );
}

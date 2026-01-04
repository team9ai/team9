import { Hash, Lock, Phone, Video, Search, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import type { ChannelWithUnread } from "@/types/im";

interface ChannelHeaderProps {
  channel: ChannelWithUnread;
}

export function ChannelHeader({ channel }: ChannelHeaderProps) {
  const ChannelIcon = channel.type === "private" ? Lock : Hash;

  // For direct messages, show the other user's info
  const isDirect = channel.type === "direct";
  const displayName = isDirect
    ? channel.otherUser?.displayName ||
      channel.otherUser?.username ||
      "Unknown User"
    : channel.name;

  const getInitials = (name: string) => {
    return name[0]?.toUpperCase() || "U";
  };

  const isOnline = channel.otherUser?.status === "online";

  return (
    <>
      <div className="h-14 px-4 flex items-center justify-between border-b">
        <div className="flex items-center gap-3">
          {isDirect && channel.otherUser ? (
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
            {isDirect &&
              channel.otherUser?.username &&
              channel.otherUser.displayName && (
                <p className="text-xs text-muted-foreground">
                  @{channel.otherUser.username}
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
          <Button variant="ghost" size="icon">
            <Info size={18} />
          </Button>
        </div>
      </div>
    </>
  );
}

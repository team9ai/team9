import { useState } from "react";
import { Hash, Lock, Info, Users, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ChannelDetailsModal } from "./ChannelDetailsModal";
import { AddMemberDialog } from "./AddMemberDialog";
import { useChannelMembers } from "@/hooks/useChannels";
import type { Channel, ChannelWithUnread, MemberRole } from "@/types/im";

interface ChannelHeaderProps {
  channel: Channel | ChannelWithUnread;
  currentUserRole?: MemberRole;
}

export function ChannelHeader({
  channel,
  currentUserRole,
}: ChannelHeaderProps) {
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isAddMemberOpen, setIsAddMemberOpen] = useState(false);
  const [defaultTab, setDefaultTab] = useState<
    "about" | "members" | "settings"
  >("about");
  const { data: members = [] } = useChannelMembers(
    channel.type !== "direct" ? channel.id : undefined,
  );
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

  const openDetails = (tab: "about" | "members" | "settings") => {
    setDefaultTab(tab);
    setIsDetailsOpen(true);
  };

  return (
    <>
      <div className="h-14 px-4 flex items-center justify-between border-b">
        <div className="flex items-center gap-3">
          {isDirect && otherUser ? (
            <div className="relative">
              <Avatar className="w-8 h-8">
                {otherUser.avatarUrl && (
                  <AvatarImage src={otherUser.avatarUrl} alt={displayName} />
                )}
                {otherUser.userType === "bot" && !otherUser.avatarUrl && (
                  <AvatarImage src="/bot.webp" alt={displayName} />
                )}
                <AvatarFallback className="bg-accent text-accent-foreground text-sm">
                  {getInitials(displayName)}
                </AvatarFallback>
              </Avatar>
              {isOnline && (
                <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-success rounded-full border-2 border-background" />
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
          {!isDirect && (
            <Button
              variant="ghost"
              className="h-8 px-2 gap-1"
              onClick={() => openDetails("members")}
            >
              <Users size={16} />
              <span className="text-sm">{members.length}</span>
            </Button>
          )}
          {/* <Button variant="ghost" size="icon">
            <Phone size={18} />
          </Button>
          <Button variant="ghost" size="icon">
            <Video size={18} />
          </Button>
          <Button variant="ghost" size="icon">
            <Search size={18} />
          </Button> */}

          {!isDirect && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsAddMemberOpen(true)}
            >
              <UserPlus size={18} className="text-info" />
            </Button>
          )}
          {!isDirect && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => openDetails("about")}
            >
              <Info size={18} />
            </Button>
          )}
        </div>
      </div>

      {/* Add Member Dialog */}
      <AddMemberDialog
        isOpen={isAddMemberOpen}
        onClose={() => setIsAddMemberOpen(false)}
        channelId={channel.id}
      />

      {/* Channel Details Modal */}
      {!isDirect && (
        <ChannelDetailsModal
          isOpen={isDetailsOpen}
          onClose={() => setIsDetailsOpen(false)}
          channelId={channel.id}
          currentUserRole={currentUserRole}
          defaultTab={defaultTab}
        />
      )}
    </>
  );
}

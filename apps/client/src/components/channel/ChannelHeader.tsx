import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, Hash, Lock, Info, Users, UserPlus } from "lucide-react";
import { AgentPillRow } from "@/components/sidebar/AgentPillRow";
import { AgentTypeBadge } from "@/components/ui/agent-type-badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { UserAvatar } from "@/components/ui/user-avatar";
import { ChannelDetailsModal } from "./ChannelDetailsModal";
import { AddMemberDialog } from "./AddMemberDialog";
import { useChannelMembers } from "@/hooks/useChannels";
import { useIsUserOnline } from "@/hooks/useIMUsers";
import type { Channel, ChannelWithUnread, MemberRole } from "@/types/im";

interface ChannelHeaderProps {
  channel: Channel | ChannelWithUnread;
  currentUserRole?: MemberRole;
}

export function ChannelHeader({
  channel,
  currentUserRole,
}: ChannelHeaderProps) {
  const { t } = useTranslation("channel");
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isAddMemberOpen, setIsAddMemberOpen] = useState(false);
  const [copiedUsername, setCopiedUsername] = useState(false);
  const [defaultTab, setDefaultTab] = useState<
    "about" | "members" | "settings"
  >("about");
  const { data: members = [] } = useChannelMembers(
    channel.type !== "direct" && channel.type !== "echo"
      ? channel.id
      : undefined,
  );
  const ChannelIcon = channel.type === "private" ? Lock : Hash;

  // For direct/echo messages, show the other user's info
  const isDirect = channel.type === "direct" || channel.type === "echo";
  const channelWithUnread = channel as ChannelWithUnread;
  const otherUser =
    "otherUser" in channelWithUnread ? channelWithUnread.otherUser : undefined;

  const displayName = isDirect
    ? otherUser?.displayName || otherUser?.username || "Unknown User"
    : channel.name;

  const isOnline = useIsUserOnline(otherUser?.id);

  const openDetails = (tab: "about" | "members" | "settings") => {
    setDefaultTab(tab);
    setIsDetailsOpen(true);
  };

  const handleCopyUsername = async (username: string) => {
    try {
      await navigator.clipboard.writeText(`@${username}`);
      setCopiedUsername(true);
      setTimeout(() => setCopiedUsername(false), 1500);
    } catch (err) {
      console.error("Failed to copy username:", err);
    }
  };

  return (
    <>
      <div className="min-h-14 py-2 px-4 flex items-center justify-between select-none">
        <div className="flex items-center gap-3">
          {isDirect && otherUser ? (
            <div className="relative">
              <UserAvatar
                userId={otherUser.id}
                name={otherUser.displayName ?? displayName}
                username={otherUser.username}
                avatarUrl={otherUser.avatarUrl}
                isBot={otherUser.userType === "bot"}
                className="w-8 h-8"
                fallbackClassName="text-sm"
              />
              {isOnline && (
                <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-success rounded-full border-2 border-background" />
              )}
            </div>
          ) : (
            <ChannelIcon size={20} className="text-muted-foreground" />
          )}
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <h2 className="font-semibold truncate">{displayName}</h2>
              {isDirect && otherUser?.username && otherUser.displayName && (
                <TooltipProvider delayDuration={150}>
                  <Tooltip open={copiedUsername ? true : undefined}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => handleCopyUsername(otherUser.username!)}
                        className="group text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer flex items-center gap-1 min-w-0 shrink"
                      >
                        <span className="truncate">@{otherUser.username}</span>
                        {copiedUsername ? (
                          <Check size={12} className="text-success shrink-0" />
                        ) : (
                          <Copy
                            size={12}
                            className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                          />
                        )}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" sideOffset={6}>
                      {copiedUsername ? t("copied") : t("clickToCopy")}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              {otherUser?.agentType !== "base_model" && (
                <AgentTypeBadge agentType={otherUser?.agentType} />
              )}
            </div>
            {otherUser?.agentType === "base_model" ? (
              <div className="mt-0.5 flex items-center gap-1 min-w-0">
                <AgentTypeBadge agentType="base_model" />
              </div>
            ) : (
              isDirect &&
              otherUser?.userType === "bot" &&
              otherUser.staffKind && (
                <AgentPillRow
                  staffKind={otherUser.staffKind}
                  roleTitle={otherUser.roleTitle}
                  ownerName={otherUser.ownerName}
                />
              )
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
              variant="outline"
              size="sm"
              className="gap-1 border-info text-info hover:bg-info/10 hover:text-info"
              onClick={() => setIsAddMemberOpen(true)}
            >
              <UserPlus size={16} />
              Invite
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

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Check,
  Copy,
  Hash,
  Lock,
  Info,
  Users,
  UserPlus,
  Pencil,
  X,
} from "lucide-react";
import { AgentPillRow } from "@/components/sidebar/AgentPillRow";
import { AgentTypeBadge } from "@/components/ui/agent-type-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { UserAvatar } from "@/components/ui/user-avatar";
import { ChannelDetailsModal } from "./ChannelDetailsModal";
import { AddMemberDialog } from "./AddMemberDialog";
import { UserHoverCard } from "./UserHoverCard";
import { useChannelMembers, useUpdateChannel } from "@/hooks/useChannels";
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
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState(channel.name ?? "");
  const [defaultTab, setDefaultTab] = useState<
    "about" | "members" | "settings"
  >("about");
  const updateChannel = useUpdateChannel();
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
    : channel.name || "Untitled";

  const associatedAgent =
    otherUser?.userType === "bot"
      ? otherUser
      : members.find((member) => member.user?.userType === "bot")?.user;
  const showAgentMetadata =
    associatedAgent?.userType === "bot" &&
    !isDirect &&
    (channel.type === "routine-session" || channel.type === "topic-session");
  const agentDisplayName =
    associatedAgent?.displayName || associatedAgent?.username || null;
  const agentIdentifier = associatedAgent?.agentId || associatedAgent?.id;
  const canEditTitle =
    !isDirect &&
    (channel.type === "topic-session" ||
      currentUserRole === "owner" ||
      currentUserRole === "admin");

  const isOnline = useIsUserOnline(otherUser?.id);

  useEffect(() => {
    if (!isEditingTitle) {
      setTitleInput(channel.name ?? "");
    }
  }, [channel.name, isEditingTitle]);

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

  const startEditingTitle = () => {
    setTitleInput(channel.name ?? "");
    setIsEditingTitle(true);
  };

  const saveTitle = async () => {
    const nextTitle = titleInput.trim();
    if (!nextTitle) return;
    if (nextTitle === (channel.name ?? "")) {
      setIsEditingTitle(false);
      return;
    }

    try {
      await updateChannel.mutateAsync({
        channelId: channel.id,
        data: { name: nextTitle },
      });
      setIsEditingTitle(false);
    } catch (error) {
      console.error("Failed to update channel title:", error);
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
            <div className="group/title flex items-center gap-2 min-w-0">
              {isEditingTitle ? (
                <form
                  className="flex items-center gap-1 min-w-0"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveTitle();
                  }}
                >
                  <Input
                    aria-label="Channel title"
                    autoFocus
                    value={titleInput}
                    onChange={(event) => setTitleInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        setIsEditingTitle(false);
                      }
                    }}
                    className="h-8 w-72 max-w-[40vw]"
                  />
                  <Button
                    type="submit"
                    variant="ghost"
                    size="icon"
                    aria-label="Save channel title"
                    disabled={!titleInput.trim() || updateChannel.isPending}
                    className="size-8"
                  >
                    <Check size={14} />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Cancel channel title edit"
                    onClick={() => setIsEditingTitle(false)}
                    className="size-8"
                  >
                    <X size={14} />
                  </Button>
                </form>
              ) : (
                <>
                  <h2 className="font-semibold truncate">{displayName}</h2>
                  {canEditTitle && (
                    <TooltipProvider delayDuration={150}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label="Edit channel title"
                            onClick={startEditingTitle}
                            className="size-7 opacity-0 transition-opacity group-hover/title:opacity-100 focus-visible:opacity-100"
                          >
                            <Pencil size={13} />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" sideOffset={6}>
                          Edit title
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </>
              )}
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
              {isDirect && otherUser?.agentType !== "base_model" && (
                <AgentTypeBadge agentType={otherUser?.agentType} />
              )}
            </div>
            {showAgentMetadata ? (
              <div className="mt-0.5 flex items-center gap-1.5 min-w-0 text-xs text-muted-foreground">
                {associatedAgent && agentDisplayName && (
                  <UserHoverCard
                    userId={associatedAgent.id}
                    displayName={agentDisplayName}
                  >
                    <span
                      aria-label={`Show ${agentDisplayName} profile`}
                      className="flex min-w-0 cursor-pointer items-center gap-1.5 rounded-sm text-foreground hover:underline"
                    >
                      <UserAvatar
                        userId={associatedAgent.id}
                        name={associatedAgent.displayName ?? agentDisplayName}
                        username={associatedAgent.username}
                        avatarUrl={associatedAgent.avatarUrl}
                        isBot={associatedAgent.userType === "bot"}
                        className="size-5 shrink-0"
                        fallbackClassName="text-[9px]"
                      />
                      <span className="truncate font-medium">
                        {agentDisplayName}
                      </span>
                    </span>
                  </UserHoverCard>
                )}
                {associatedAgent?.roleTitle && (
                  <Badge
                    variant="outline"
                    size="sm"
                    className="h-5 shrink-0 rounded-md border-emerald-200 bg-emerald-50 px-1.5 text-[10px] font-medium text-emerald-700"
                  >
                    {associatedAgent.roleTitle}
                  </Badge>
                )}
                <AgentTypeBadge agentType={associatedAgent?.agentType} />
                {agentIdentifier && (
                  <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
                    {agentIdentifier}
                  </span>
                )}
              </div>
            ) : otherUser?.agentType === "base_model" ? (
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

import { useTranslation } from "react-i18next";
import { ChevronDown, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useMemo } from "react";
import { useUserWorkspaces, useWorkspaceMembers } from "@/hooks/useWorkspace";
import {
  useChannelsByType,
  useCreateDirectChannel,
  useSetSidebarVisibility,
} from "@/hooks/useChannels";
import { useTopicSessionsGrouped } from "@/hooks/useTopicSessions";
import { useCurrentUser } from "@/hooks/useAuth";
import { useWorkspaceStore } from "@/stores";
import { UserListItem } from "@/components/sidebar/UserListItem";
import { AgentGroupList } from "@/components/sidebar/AgentGroupList";

export function MessagesSubSidebar() {
  const { t } = useTranslation(["navigation", "common"]);
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  const selectedChannelId = (params as { channelId?: string }).channelId;

  const { data: currentUser } = useCurrentUser();
  const { data: workspaces } = useUserWorkspaces();
  const { selectedWorkspaceId } = useWorkspaceStore();
  const {
    directChannels = [],
    allDirectChannels = [],
    isLoading: isLoadingChannels,
  } = useChannelsByType();
  const setSidebarVisibility = useSetSidebarVisibility();
  const { data: agentGroups = [], isLoading: isLoadingAgents } =
    useTopicSessionsGrouped(5);
  // Use selected workspace or fallback to first workspace
  const currentWorkspace =
    workspaces?.find((w) => w.id === selectedWorkspaceId) || workspaces?.[0];

  const { data: membersData, isLoading: isLoadingMembers } =
    useWorkspaceMembers(currentWorkspace?.id);

  // Flatten paginated data
  const members = useMemo(() => {
    if (!membersData?.pages) return [];
    return membersData.pages.flatMap((page) => page.members);
  }, [membersData]);
  const createDirectChannel = useCreateDirectChannel();

  // Extract users from direct channels (existing conversations).
  // Bots are rendered under the dedicated AI Agents section, so the
  // human-DM list below filters them out to avoid a double-appearance.
  const directMessageUsers = useMemo(() => {
    return directChannels
      .filter((channel) => channel.otherUser?.userType !== "bot")
      .map((channel) => {
        const otherUser = channel.otherUser;
        const displayName =
          otherUser?.displayName || otherUser?.username || "Direct Message";

        return {
          id: channel.id,
          channelId: channel.id,
          userId: otherUser?.id,
          name: displayName,
          avatarUrl: otherUser?.avatarUrl,
          agentType: otherUser?.agentType,
          staffKind: otherUser?.staffKind ?? null,
          roleTitle: otherUser?.roleTitle ?? null,
          ownerName: otherUser?.ownerName ?? null,
          unreadCount: channel.unreadCount || 0,
          isBot: otherUser?.userType === "bot",
        };
      });
  }, [directChannels]);

  const filteredMembers = useMemo(() => {
    const existingDmUserIds = new Set(
      directChannels.map((channel) => channel.otherUser?.id).filter(Boolean),
    );

    return members.filter(
      (m) => m.userId !== currentUser?.id && !existingDmUserIds.has(m.userId),
    );
  }, [members, currentUser?.id, directChannels]);

  const handleMemberClick = async (memberId: string) => {
    try {
      const channel = await createDirectChannel.mutateAsync(memberId);

      // If channel was hidden, unhide it
      const existing = allDirectChannels.find((ch) => ch.id === channel.id);
      if (existing && existing.showInDmSidebar === false) {
        setSidebarVisibility.mutate({ channelId: channel.id, show: true });
      }

      navigate({
        to: "/messages/$channelId",
        params: { channelId: channel.id },
      });
    } catch (error) {
      console.error("Failed to create/open direct channel:", error);
    }
  };

  // Only show loading when we truly have nothing to display.
  // When cached data exists, keep showing it during background refetches.
  const hasAnyContent =
    directMessageUsers.length > 0 || filteredMembers.length > 0;
  const isLoading = !hasAnyContent && (isLoadingChannels || isLoadingMembers);

  return (
    <aside className="w-64 h-full overflow-hidden bg-nav-sub-bg text-primary-foreground flex flex-col">
      {/* Header */}
      <div className="p-4 pb-2">
        <Button
          variant="ghost"
          className="w-full justify-between text-nav-foreground hover:bg-nav-hover px-2 h-auto py-1.5"
        >
          <span className="font-semibold text-lg">{t("directMessages")}</span>
          <ChevronDown size={16} className="text-nav-foreground-subtle" />
        </Button>
      </div>

      <Separator className="bg-nav-border" />

      {/* Messages List */}
      <ScrollArea className="flex-1 min-h-0 px-3">
        <nav className="space-y-0.5 pb-3 pt-2">
          {/* AI Agents — topic sessions grouped per agent.
              Rendered above the human-DM list so users see their
              AI conversations first (most common case today). */}
          {(agentGroups.length > 0 || isLoadingAgents) && (
            <div className="pb-2 mb-2 border-b border-nav-border">
              <div className="px-2 py-1 text-[0.7rem] font-semibold uppercase tracking-wide text-nav-foreground-faint">
                {t("aiAgents", { defaultValue: "AI Agents" })}
              </div>
              <AgentGroupList
                groups={agentGroups}
                selectedChannelId={selectedChannelId}
                linkPrefix="/messages"
                isLoading={isLoadingAgents}
              />
            </div>
          )}

          {isLoading ? (
            <p className="text-xs text-nav-foreground-faint px-2 py-2">
              {t("common:loading")}
            </p>
          ) : (
            <>
              {/* Existing DM Conversations */}
              {directMessageUsers.length > 0 &&
                directMessageUsers.map((dm) => (
                  <ContextMenu key={dm.id}>
                    <ContextMenuTrigger className="block w-full">
                      <UserListItem
                        name={dm.name}
                        avatarUrl={dm.avatarUrl}
                        userId={dm.userId}
                        isSelected={selectedChannelId === dm.channelId}
                        unreadCount={dm.unreadCount}
                        channelId={dm.channelId}
                        linkPrefix="/messages"
                        isBot={dm.isBot}
                        agentType={dm.agentType}
                        staffKind={dm.staffKind}
                        roleTitle={dm.roleTitle}
                        ownerName={dm.ownerName}
                      />
                    </ContextMenuTrigger>
                    <ContextMenuContent className="w-48">
                      <ContextMenuItem
                        onClick={() =>
                          setSidebarVisibility.mutate({
                            channelId: dm.channelId,
                            show: false,
                          })
                        }
                      >
                        <EyeOff className="mr-2 h-4 w-4" />
                        {t("hideConversation")}
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                ))}

              {/* Other Members (no existing DM) */}
              {filteredMembers.length > 0 && (
                <>
                  {directMessageUsers.length > 0 && (
                    <div className="px-2 py-2 text-xs text-nav-foreground-faint mt-2">
                      {t("messagesStartConversation")}
                    </div>
                  )}
                  {filteredMembers.map((member) => {
                    const displayName = member.displayName || member.username;
                    return (
                      <UserListItem
                        key={member.id}
                        name={displayName}
                        userId={member.userId}
                        subtitle={
                          member.displayName ? `@${member.username}` : undefined
                        }
                        onClick={() => handleMemberClick(member.userId)}
                        disabled={createDirectChannel.isPending}
                        isBot={member.userType === "bot"}
                      />
                    );
                  })}
                </>
              )}

              {/* Empty State */}
              {directMessageUsers.length === 0 &&
                filteredMembers.length === 0 && (
                  <p className="text-xs text-nav-foreground-faint px-2 py-2">
                    {t("messagesNoMessages")}
                  </p>
                )}
            </>
          )}
        </nav>
      </ScrollArea>
    </aside>
  );
}

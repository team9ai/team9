import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useMemo } from "react";
import { useUserWorkspaces, useWorkspaceMembers } from "@/hooks/useWorkspace";
import { useChannelsByType, useCreateDirectChannel } from "@/hooks/useChannels";
import { useCurrentUser } from "@/hooks/useAuth";
import { useWorkspaceStore } from "@/stores";
import { UserListItem } from "@/components/sidebar/UserListItem";

export function MessagesSubSidebar() {
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  const selectedChannelId = (params as { channelId?: string }).channelId;

  const { data: currentUser } = useCurrentUser();
  const { data: workspaces } = useUserWorkspaces();
  const { selectedWorkspaceId } = useWorkspaceStore();
  const { directChannels = [], isLoading: isLoadingChannels } =
    useChannelsByType();
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

  // Extract users from direct channels (existing conversations)
  const directMessageUsers = useMemo(() => {
    return directChannels.map((channel) => {
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
        unreadCount: channel.unreadCount || 0,
        isBot: otherUser?.userType === "bot",
      };
    });
  }, [directChannels]);

  // Filter members: exclude current user and those with existing DM channels
  const existingDmUserIds = new Set(
    directChannels.map((ch) => ch.otherUser?.id).filter(Boolean),
  );

  const filteredMembers = useMemo(() => {
    return members.filter(
      (m) => m.userId !== currentUser?.id && !existingDmUserIds.has(m.userId),
    );
  }, [members, currentUser?.id, existingDmUserIds]);

  const handleMemberClick = async (memberId: string) => {
    try {
      const channel = await createDirectChannel.mutateAsync(memberId);
      navigate({
        to: "/messages/$channelId",
        params: { channelId: channel.id },
      });
    } catch (error) {
      console.error("Failed to create/open direct channel:", error);
    }
  };

  const getInitials = (name: string) => {
    return name[0]?.toUpperCase() || "U";
  };

  const isLoading = isLoadingChannels || isLoadingMembers;

  return (
    <aside className="w-64 h-full overflow-hidden bg-nav-sub-bg text-primary-foreground flex flex-col">
      {/* Header */}
      <div className="p-4 pb-2">
        <Button
          variant="ghost"
          className="w-full justify-between text-nav-foreground hover:bg-nav-hover px-2 h-auto py-1.5"
        >
          <span className="font-semibold text-lg">Direct Messages</span>
          <ChevronDown size={16} className="text-nav-foreground-subtle" />
        </Button>
      </div>

      <Separator className="bg-nav-border" />

      {/* Messages List */}
      <ScrollArea className="flex-1 min-h-0 px-3">
        <nav className="space-y-0.5 pb-3 pt-2">
          {isLoading ? (
            <p className="text-xs text-nav-foreground-faint px-2 py-2">
              Loading...
            </p>
          ) : (
            <>
              {/* Existing DM Conversations */}
              {directMessageUsers.length > 0 &&
                directMessageUsers.map((dm) => (
                  <UserListItem
                    key={dm.id}
                    name={dm.name}
                    avatar={dm.avatar}
                    avatarUrl={dm.avatarUrl}
                    userId={dm.userId}
                    isSelected={selectedChannelId === dm.channelId}
                    unreadCount={dm.unreadCount}
                    channelId={dm.channelId}
                    linkPrefix="/messages"
                    isBot={dm.isBot}
                  />
                ))}

              {/* Other Members (no existing DM) */}
              {filteredMembers.length > 0 && (
                <>
                  {directMessageUsers.length > 0 && (
                    <div className="px-2 py-2 text-xs text-nav-foreground-faint mt-2">
                      Start a conversation
                    </div>
                  )}
                  {filteredMembers.map((member) => {
                    const displayName = member.displayName || member.username;
                    return (
                      <UserListItem
                        key={member.id}
                        name={displayName}
                        avatar={getInitials(displayName)}
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
                    No messages yet
                  </p>
                )}
            </>
          )}
        </nav>
      </ScrollArea>
    </aside>
  );
}

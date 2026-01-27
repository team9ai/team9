import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useMemo } from "react";
import { useUserWorkspaces, useWorkspaceMembers } from "@/hooks/useWorkspace";
import { useChannelsByType, useCreateDirectChannel } from "@/hooks/useChannels";
import { useOnlineUsers } from "@/hooks/useIMUsers";
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
  const { data: onlineUsers = {} } = useOnlineUsers();

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
        status: otherUser?.status || ("offline" as const),
        unreadCount: channel.unreadCount || 0,
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
    <aside className="w-64 h-full overflow-hidden bg-[#5b2c6f] text-white flex flex-col">
      {/* Header */}
      <div className="p-4 pb-2">
        <Button
          variant="ghost"
          className="w-full justify-between text-white hover:bg-white/10 px-2 h-auto py-1.5"
        >
          <span className="font-semibold text-lg">Direct Messages</span>
          <ChevronDown size={16} className="text-white/70" />
        </Button>
      </div>

      <Separator className="bg-white/10" />

      {/* Messages List */}
      <ScrollArea className="flex-1 min-h-0 px-3">
        <nav className="space-y-0.5 pb-3 pt-2">
          {isLoading ? (
            <p className="text-xs text-white/50 px-2 py-2">Loading...</p>
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
                    isOnline={dm.userId ? dm.userId in onlineUsers : false}
                    isSelected={selectedChannelId === dm.channelId}
                    unreadCount={dm.unreadCount}
                    channelId={dm.channelId}
                    linkPrefix="/messages"
                  />
                ))}

              {/* Other Members (no existing DM) */}
              {filteredMembers.length > 0 && (
                <>
                  {directMessageUsers.length > 0 && (
                    <div className="px-2 py-2 text-xs text-white/50 mt-2">
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
                        isOnline={member.status === "online"}
                        subtitle={
                          member.displayName ? `@${member.username}` : undefined
                        }
                        onClick={() => handleMemberClick(member.userId)}
                        disabled={createDirectChannel.isPending}
                      />
                    );
                  })}
                </>
              )}

              {/* Empty State */}
              {directMessageUsers.length === 0 &&
                filteredMembers.length === 0 && (
                  <p className="text-xs text-white/50 px-2 py-2">
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

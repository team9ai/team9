import { Search, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useState, useMemo, useEffect } from "react";
import { useUserWorkspaces, useWorkspaceMembers } from "@/hooks/useWorkspace";
import { useChannelsByType, useCreateDirectChannel } from "@/hooks/useChannels";
import { useOnlineUsers } from "@/hooks/useIMUsers";
import { useCurrentUser } from "@/hooks/useAuth";
import { useQueryClient } from "@tanstack/react-query";
import wsService from "@/services/websocket";
import { useWorkspaceStore } from "@/stores";

export function MessagesSubSidebar() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
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
  const [searchQuery, setSearchQuery] = useState("");

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
        oderId: otherUser?.id,
        name: displayName,
        avatar: avatarText,
        avatarUrl: otherUser?.avatarUrl,
        status: otherUser?.status || ("offline" as const),
        unreadCount: channel.unreadCount || 0,
      };
    });
  }, [directChannels]);

  // Listen for user online/offline events
  useEffect(() => {
    const handleUserOnline = () => {
      if (currentWorkspace?.id) {
        queryClient.invalidateQueries({
          queryKey: ["workspace-members", currentWorkspace.id],
        });
      }
    };

    const handleUserOffline = () => {
      if (currentWorkspace?.id) {
        queryClient.invalidateQueries({
          queryKey: ["workspace-members", currentWorkspace.id],
        });
      }
    };

    wsService.on("user_online", handleUserOnline);
    wsService.on("user_offline", handleUserOffline);

    return () => {
      wsService.off("user_online", handleUserOnline);
      wsService.off("user_offline", handleUserOffline);
    };
  }, [currentWorkspace?.id, queryClient]);

  // Filter members: exclude current user and those with existing DM channels
  const existingDmUserIds = new Set(
    directChannels.map((ch) => ch.otherUser?.id).filter(Boolean),
  );

  const filteredMembers = useMemo(() => {
    let result = members.filter(
      (m) => m.userId !== currentUser?.id && !existingDmUserIds.has(m.userId),
    );

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (m) =>
          m.username.toLowerCase().includes(query) ||
          m.displayName?.toLowerCase().includes(query),
      );
    }

    return result;
  }, [members, currentUser?.id, searchQuery, existingDmUserIds]);

  // Filter existing DMs by search query
  const filteredDMs = useMemo(() => {
    if (!searchQuery) return directMessageUsers;
    const query = searchQuery.toLowerCase();
    return directMessageUsers.filter((dm) =>
      dm.name.toLowerCase().includes(query),
    );
  }, [directMessageUsers, searchQuery]);

  const handleMemberClick = async (memberId: string) => {
    try {
      const channel = await createDirectChannel.mutateAsync(memberId);
      navigate({
        to: "/channels/$channelId",
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
    <aside className="w-64 bg-[#5b2c6f] text-white flex flex-col">
      {/* Header */}
      <div className="p-4">
        <Button
          variant="ghost"
          className="w-full justify-between text-white hover:bg-white/10 px-2 h-auto py-1.5"
        >
          <span className="font-semibold text-lg">Direct Messages</span>
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
            placeholder="Search messages..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 h-9 bg-white/10 border-white/20 text-white placeholder:text-white/50 focus:bg-white/15"
          />
        </div>
      </div>

      <Separator className="bg-white/10" />

      {/* Messages List */}
      <ScrollArea className="flex-1 px-3">
        <nav className="space-y-0.5 pb-3 pt-2">
          {isLoading ? (
            <p className="text-xs text-white/50 px-2 py-2">Loading...</p>
          ) : (
            <>
              {/* Existing DM Conversations */}
              {filteredDMs.length > 0 && (
                <>
                  {filteredDMs.map((dm) => {
                    const isOnline = dm.oderId
                      ? dm.oderId in onlineUsers
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
                            <Avatar className="w-8 h-8">
                              {dm.avatarUrl && (
                                <AvatarImage src={dm.avatarUrl} alt={dm.name} />
                              )}
                              <AvatarFallback className="bg-purple-400 text-white text-sm">
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
                            <Badge
                              variant="notification"
                              size="sm"
                              count={dm.unreadCount}
                            />
                          )}
                        </Button>
                      </Link>
                    );
                  })}
                </>
              )}

              {/* Other Members (no existing DM) */}
              {filteredMembers.length > 0 && (
                <>
                  {filteredDMs.length > 0 && (
                    <div className="px-2 py-2 text-xs text-white/50 mt-2">
                      Start a conversation
                    </div>
                  )}
                  {filteredMembers.map((member) => {
                    const isOnline = member.status === "online";
                    const displayName = member.displayName || member.username;

                    return (
                      <Button
                        key={member.id}
                        variant="ghost"
                        onClick={() => handleMemberClick(member.userId)}
                        disabled={createDirectChannel.isPending}
                        className="w-full justify-start gap-2 px-2 h-auto py-2 text-sm text-white/80 hover:bg-white/10 hover:text-white disabled:opacity-50"
                      >
                        <div className="relative">
                          <Avatar className="w-8 h-8">
                            <AvatarFallback className="bg-purple-400 text-white text-sm">
                              {getInitials(displayName)}
                            </AvatarFallback>
                          </Avatar>
                          {isOnline && (
                            <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-[#5b2c6f]" />
                          )}
                        </div>
                        <div className="flex-1 text-left truncate">
                          <div className="truncate">{displayName}</div>
                          {member.displayName && (
                            <div className="text-xs text-white/50 truncate">
                              @{member.username}
                            </div>
                          )}
                        </div>
                      </Button>
                    );
                  })}
                </>
              )}

              {/* Empty State */}
              {filteredDMs.length === 0 && filteredMembers.length === 0 && (
                <p className="text-xs text-white/50 px-2 py-2">
                  {searchQuery ? "No results found" : "No messages yet"}
                </p>
              )}
            </>
          )}
        </nav>
      </ScrollArea>
    </aside>
  );
}

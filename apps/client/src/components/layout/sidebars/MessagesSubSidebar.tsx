import { Search, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useNavigate } from "@tanstack/react-router";
import { useState, useMemo, useEffect } from "react";
import { useUserWorkspaces, useWorkspaceMembers } from "@/hooks/useWorkspace";
import { useCreateDirectChannel } from "@/hooks/useChannels";
import { useCurrentUser } from "@/hooks/useAuth";
import { useQueryClient } from "@tanstack/react-query";
import wsService from "@/services/websocket";
import { useWorkspaceStore } from "@/stores";

export function MessagesSubSidebar() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: currentUser } = useCurrentUser();
  const { data: workspaces } = useUserWorkspaces();
  const { selectedWorkspaceId } = useWorkspaceStore();

  // Use selected workspace or fallback to first workspace
  const currentWorkspace =
    workspaces?.find((w) => w.id === selectedWorkspaceId) || workspaces?.[0];

  const { data: members = [], isLoading } = useWorkspaceMembers(
    currentWorkspace?.id,
  );
  const createDirectChannel = useCreateDirectChannel();
  const [searchQuery, setSearchQuery] = useState("");

  // Listen for user online/offline events
  useEffect(() => {
    const handleUserOnline = () => {
      // Refresh members list to get updated online status
      if (currentWorkspace?.id) {
        queryClient.invalidateQueries({
          queryKey: ["workspace-members", currentWorkspace.id],
        });
      }
    };

    const handleUserOffline = () => {
      // Refresh members list to get updated online status
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

  // Filter out current user and apply search
  const filteredMembers = useMemo(() => {
    let result = members.filter((m) => m.userId !== currentUser?.id);

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (m) =>
          m.username.toLowerCase().includes(query) ||
          m.displayName?.toLowerCase().includes(query),
      );
    }

    return result;
  }, [members, currentUser?.id, searchQuery]);

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
            placeholder="Search members..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 h-9 bg-white/10 border-white/20 text-white placeholder:text-white/50 focus:bg-white/15"
          />
        </div>
      </div>

      <Separator className="bg-white/10" />

      {/* Members List */}
      <ScrollArea className="flex-1 px-3">
        <nav className="space-y-0.5 pb-3 pt-2">
          {isLoading ? (
            <p className="text-xs text-white/50 px-2 py-2">Loading...</p>
          ) : filteredMembers.length === 0 ? (
            <p className="text-xs text-white/50 px-2 py-2">
              {searchQuery ? "No members found" : "No members"}
            </p>
          ) : (
            filteredMembers.map((member) => {
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
            })
          )}
        </nav>
      </ScrollArea>
    </aside>
  );
}

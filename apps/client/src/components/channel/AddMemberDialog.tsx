import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { Search, UserPlus, Check, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useWorkspaceMembers } from "@/hooks/useWorkspace";
import { useChannelMembers, useAddChannelMember } from "@/hooks/useChannels";
import { useSelectedWorkspaceId } from "@/stores";
import type { WorkspaceMember } from "@/types/workspace";

interface AddMemberDialogProps {
  isOpen: boolean;
  onClose: () => void;
  channelId: string;
}

export function AddMemberDialog({
  isOpen,
  onClose,
  channelId,
}: AddMemberDialogProps) {
  const { t } = useTranslation("channel");
  const workspaceId = useSelectedWorkspaceId();
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  const {
    data: workspaceMembersData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useWorkspaceMembers(workspaceId ?? undefined, {
    search: search || undefined,
  });

  const { data: channelMembers = [] } = useChannelMembers(channelId);
  const addMember = useAddChannelMember(channelId);

  // Flatten paginated data
  const workspaceMembers = useMemo(() => {
    if (!workspaceMembersData?.pages) return [];
    return workspaceMembersData.pages.flatMap((page) => page.members);
  }, [workspaceMembersData]);

  // Get existing channel member user IDs
  const existingMemberIds = useMemo(() => {
    return new Set(channelMembers.map((m) => m.userId));
  }, [channelMembers]);

  // Filter out existing members
  const availableMembers = useMemo(() => {
    return workspaceMembers.filter((m) => !existingMemberIds.has(m.userId));
  }, [workspaceMembers, existingMemberIds]);

  // Handle scroll for infinite loading
  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    if (
      scrollHeight - scrollTop <= clientHeight * 1.5 &&
      hasNextPage &&
      !isFetchingNextPage
    ) {
      fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  // Toggle member selection
  const toggleSelection = (userId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  };

  // Handle add members
  const handleAddMembers = async () => {
    try {
      for (const userId of selectedIds) {
        await addMember.mutateAsync({ userId });
      }
      setSelectedIds(new Set());
      onClose();
    } catch (error) {
      console.error("Failed to add members:", error);
    }
  };

  // Reset state when dialog closes
  useEffect(() => {
    if (!isOpen) {
      setSearch("");
      setSelectedIds(new Set());
    }
  }, [isOpen]);

  const renderMemberItem = (member: WorkspaceMember) => {
    const isSelected = selectedIds.has(member.userId);
    const displayName = member.displayName || member.username;

    return (
      <button
        key={member.userId}
        onClick={() => toggleSelection(member.userId)}
        className={`flex items-center justify-between w-full p-3 rounded-lg transition-colors ${
          isSelected ? "bg-blue-50 hover:bg-blue-100" : "hover:bg-slate-50"
        }`}
      >
        <div className="flex items-center gap-3">
          <Avatar className="w-9 h-9">
            {member.avatarUrl && <AvatarImage src={member.avatarUrl} />}
            <AvatarFallback className="bg-purple-100 text-purple-700">
              {displayName[0].toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="text-left">
            <p className="text-sm font-medium">{displayName}</p>
            <p className="text-xs text-slate-500">@{member.username}</p>
          </div>
        </div>
        {isSelected && (
          <div className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center">
            <Check size={12} className="text-white" />
          </div>
        )}
      </button>
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="w-100 max-w-[90vw] h-140 max-h-[80vh] p-0 gap-0 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b">
          <DialogTitle className="flex items-center gap-2">
            <UserPlus size={20} className="text-slate-600" />
            <span>{t("addMembers")}</span>
          </DialogTitle>
        </div>

        {/* Search */}
        <div className="px-6 py-4">
          <div className="relative">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <Input
              placeholder={t("searchMember")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        {/* Members List */}
        <ScrollArea
          className="flex-1 px-6"
          onScrollCapture={handleScroll}
          ref={scrollRef}
        >
          <div className="space-y-1 pb-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
              </div>
            ) : availableMembers.length === 0 ? (
              <div className="text-center py-8 text-slate-500">
                {search ? t("noMatchingUsers") : t("allMembersInChannel")}
              </div>
            ) : (
              <>
                {availableMembers.map(renderMemberItem)}
                {isFetchingNextPage && (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
                  </div>
                )}
              </>
            )}
          </div>
        </ScrollArea>

        {/* Footer */}
        <div className="px-6 py-4 border-t flex items-center justify-between">
          <span className="text-sm text-slate-500">
            {selectedIds.size > 0
              ? t("selectedCount", { count: selectedIds.size })
              : t("selectMembersToAdd")}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              {t("cancel", { ns: "common" })}
            </Button>
            <Button
              onClick={handleAddMembers}
              disabled={selectedIds.size === 0 || addMember.isPending}
            >
              {addMember.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {t("adding")}
                </>
              ) : selectedIds.size > 0 ? (
                t("addCount", { count: selectedIds.size })
              ) : (
                t("add")
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

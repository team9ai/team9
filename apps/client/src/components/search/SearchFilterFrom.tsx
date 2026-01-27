import { useState, useMemo } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { useWorkspaceMembers } from "@/hooks/useWorkspace";
import { useSelectedWorkspaceId, useUser } from "@/stores";

interface SearchFilterFromProps {
  selectedUserIds: string[];
  onSelectionChange: (userIds: string[]) => void;
}

export function SearchFilterFrom({
  selectedUserIds,
  onSelectionChange,
}: SearchFilterFromProps) {
  const { t } = useTranslation("common");
  const [isOpen, setIsOpen] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const workspaceId = useSelectedWorkspaceId();
  const currentUser = useUser();

  const { data, isLoading } = useWorkspaceMembers(workspaceId ?? undefined, {
    search: searchInput || undefined,
    limit: 50,
  });

  // Flatten paginated data
  const members = useMemo(() => {
    if (!data?.pages) return [];
    return data.pages.flatMap((page) => page.members);
  }, [data]);

  // Sort members: current user first, then selected users, then others
  const sortedMembers = useMemo(() => {
    return [...members].sort((a, b) => {
      const aIsCurrentUser = a.userId === currentUser?.id;
      const bIsCurrentUser = b.userId === currentUser?.id;
      const aIsSelected = selectedUserIds.includes(a.userId);
      const bIsSelected = selectedUserIds.includes(b.userId);

      if (aIsCurrentUser && !bIsCurrentUser) return -1;
      if (!aIsCurrentUser && bIsCurrentUser) return 1;
      if (aIsSelected && !bIsSelected) return -1;
      if (!aIsSelected && bIsSelected) return 1;
      return 0;
    });
  }, [members, selectedUserIds, currentUser?.id]);

  const handleToggleMember = (memberId: string) => {
    if (selectedUserIds.includes(memberId)) {
      onSelectionChange(selectedUserIds.filter((id) => id !== memberId));
    } else {
      onSelectionChange([...selectedUserIds, memberId]);
    }
  };

  const handleClear = () => {
    onSelectionChange([]);
    setIsOpen(false);
  };

  const hasSelection = selectedUserIds.length > 0;

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "gap-1",
            hasSelection && "bg-primary/10 border-primary",
          )}
        >
          From
          {hasSelection && (
            <span className="ml-1 px-1.5 py-0.5 text-xs bg-primary text-primary-foreground rounded">
              {selectedUserIds.length}
            </span>
          )}
          <ChevronDown className="h-4 w-4 ml-1" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        {/* Search Input */}
        <div className="p-2 border-b">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={t("searchUsers", "Search users...")}
              className="pl-8 h-8"
            />
          </div>
        </div>

        {/* Clear Selection */}
        {hasSelection && (
          <button
            onClick={handleClear}
            className="w-full px-3 py-2 text-left text-sm text-muted-foreground hover:bg-accent flex items-center gap-2 border-b"
          >
            <X className="h-4 w-4" />
            {t("clearSelection", "Clear selection")}
          </button>
        )}

        {/* Members List */}
        <div className="max-h-64 overflow-y-auto py-1">
          {isLoading ? (
            <div className="py-4 text-center text-sm text-muted-foreground">
              {t("loading", "Loading...")}
            </div>
          ) : sortedMembers.length === 0 ? (
            <div className="py-4 text-center text-sm text-muted-foreground">
              {t("noUsersFound", "No users found")}
            </div>
          ) : (
            <>
              {/* Suggestions header */}
              <div className="px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase">
                {t("suggestions", "Suggestions")}
              </div>
              {sortedMembers.map((member) => {
                const isSelected = selectedUserIds.includes(member.userId);
                const isCurrentUser = member.userId === currentUser?.id;

                return (
                  <button
                    key={member.userId}
                    className={cn(
                      "w-full px-3 py-2 text-left hover:bg-accent flex items-center gap-3",
                      isSelected &&
                        "bg-primary text-primary-foreground hover:bg-primary",
                    )}
                    onClick={() => handleToggleMember(member.userId)}
                  >
                    <Checkbox
                      checked={isSelected}
                      className={cn(
                        isSelected &&
                          "border-primary-foreground data-[state=checked]:bg-primary-foreground data-[state=checked]:text-primary",
                      )}
                    />
                    <Avatar className="h-6 w-6">
                      <AvatarImage src={member.avatarUrl || undefined} />
                      <AvatarFallback className="text-xs">
                        {(member.displayName ||
                          member.username)?.[0]?.toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="flex-1 truncate text-sm">
                      {member.displayName || member.username}
                      {isCurrentUser && (
                        <span
                          className={cn(
                            "ml-1",
                            isSelected
                              ? "text-primary-foreground/70"
                              : "text-muted-foreground",
                          )}
                        >
                          ({t("you", "you")})
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

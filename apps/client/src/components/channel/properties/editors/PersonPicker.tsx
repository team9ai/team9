import { useCallback, useMemo, useState } from "react";
import { Check, X } from "lucide-react";

import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useChannelMembers } from "@/hooks/useChannels";
import { cn } from "@/lib/utils";
import type { PropertyDefinition } from "@/types/properties";

interface PersonPickerProps {
  definition: PropertyDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
}

export function PersonPicker({
  definition,
  value,
  onChange,
  disabled,
}: PersonPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const { data: members = [] } = useChannelMembers(definition.channelId);

  const selectedIds = useMemo(() => {
    if (Array.isArray(value)) return value as string[];
    if (typeof value === "string") return [value];
    return [];
  }, [value]);

  const filteredMembers = useMemo(() => {
    if (!search) return members;
    const lower = search.toLowerCase();
    return members.filter((m) => {
      const name = m.user?.displayName || m.user?.username || m.userId;
      return name.toLowerCase().includes(lower);
    });
  }, [members, search]);

  const handleToggle = useCallback(
    (userId: string) => {
      const next = selectedIds.includes(userId)
        ? selectedIds.filter((id) => id !== userId)
        : [...selectedIds, userId];
      onChange(next);
    },
    [selectedIds, onChange],
  );

  const handleRemove = useCallback(
    (userId: string) => {
      onChange(selectedIds.filter((id) => id !== userId));
    },
    [selectedIds, onChange],
  );

  const selectedMembers = selectedIds
    .map((id) => members.find((m) => m.userId === id))
    .filter(Boolean);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          className={cn(
            "flex min-h-9 w-full flex-wrap items-center gap-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm",
            "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          {selectedMembers.length > 0 ? (
            selectedMembers.map((member) => {
              if (!member) return null;
              const user = member.user;
              return (
                <span
                  key={member.userId}
                  className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground"
                >
                  <UserAvatar
                    userId={member.userId}
                    name={user?.displayName}
                    username={user?.username}
                    avatarUrl={user?.avatarUrl}
                    className="h-4 w-4"
                  />
                  {user?.displayName || user?.username || member.userId}
                  {!disabled && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemove(member.userId);
                      }}
                      className="ml-0.5 rounded-full hover:bg-black/10"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </span>
              );
            })
          ) : (
            <span className="text-muted-foreground">Select people...</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <div className="p-2">
          <Input
            type="text"
            placeholder="Search members..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8"
          />
        </div>
        <div className="max-h-60 overflow-y-auto p-1">
          {filteredMembers.map((member) => {
            const user = member.user;
            const isSelected = selectedIds.includes(member.userId);
            return (
              <button
                key={member.userId}
                type="button"
                onClick={() => handleToggle(member.userId)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm",
                  "hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <span className="flex h-4 w-4 items-center justify-center">
                  {isSelected && <Check className="h-3.5 w-3.5" />}
                </span>
                <UserAvatar
                  userId={member.userId}
                  name={user?.name}
                  username={user?.username}
                  avatarUrl={user?.avatarUrl}
                  className="h-6 w-6"
                />
                <span className="truncate">
                  {user?.displayName || user?.username || member.userId}
                </span>
              </button>
            );
          })}
          {filteredMembers.length === 0 && (
            <p className="px-2 py-4 text-center text-sm text-muted-foreground">
              No members found
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

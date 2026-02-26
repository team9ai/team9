import { useState, useMemo } from "react";
import { SmilePlus } from "lucide-react";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { EmojiPicker } from "./editor/EmojiPicker";
import { cn } from "@/lib/utils";
import type { MessageReaction } from "@/types/im";

interface GroupedReaction {
  emoji: string;
  count: number;
  userIds: string[];
  hasCurrentUser: boolean;
}

interface MessageReactionsProps {
  reactions: MessageReaction[];
  currentUserId?: string;
  onAddReaction: (emoji: string) => void;
  onRemoveReaction: (emoji: string) => void;
}

export function MessageReactions({
  reactions,
  currentUserId,
  onAddReaction,
  onRemoveReaction,
}: MessageReactionsProps) {
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);

  const grouped = useMemo(() => {
    const map = new Map<string, GroupedReaction>();
    for (const r of reactions) {
      const existing = map.get(r.emoji);
      if (existing) {
        existing.count++;
        existing.userIds.push(r.userId);
        if (r.userId === currentUserId) existing.hasCurrentUser = true;
      } else {
        map.set(r.emoji, {
          emoji: r.emoji,
          count: 1,
          userIds: [r.userId],
          hasCurrentUser: r.userId === currentUserId,
        });
      }
    }
    return Array.from(map.values());
  }, [reactions, currentUserId]);

  if (grouped.length === 0) return null;

  const handleToggle = (g: GroupedReaction) => {
    if (g.hasCurrentUser) {
      onRemoveReaction(g.emoji);
    } else {
      onAddReaction(g.emoji);
    }
  };

  const handlePickerSelect = (emoji: string) => {
    onAddReaction(emoji);
    setEmojiPickerOpen(false);
  };

  return (
    <TooltipProvider>
      <div className="flex flex-wrap items-center gap-1 mt-1">
        {grouped.map((g) => (
          <Tooltip key={g.emoji}>
            <TooltipTrigger asChild>
              <button
                onClick={() => handleToggle(g)}
                className={cn(
                  "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs border transition-colors",
                  g.hasCurrentUser
                    ? "bg-info/10 border-info/40 text-info hover:bg-info/20"
                    : "bg-muted/50 border-border hover:bg-muted",
                )}
              >
                <span>{g.emoji}</span>
                <span>{g.count}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={4}>
              {g.emoji} {g.count}
            </TooltipContent>
          </Tooltip>
        ))}

        <Popover open={emojiPickerOpen} onOpenChange={setEmojiPickerOpen}>
          <PopoverTrigger asChild>
            <button className="inline-flex items-center justify-center w-6 h-6 rounded-full border border-dashed border-border text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
              <SmilePlus size={12} />
            </button>
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="start"
            sideOffset={8}
            className="w-auto p-0 border-none shadow-lg"
          >
            <EmojiPicker onSelect={handlePickerSelect} />
          </PopoverContent>
        </Popover>
      </div>
    </TooltipProvider>
  );
}

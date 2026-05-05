import { useState, type ReactNode } from "react";
import { MessageSquare, SmilePlus, Forward, CheckSquare } from "lucide-react";
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

const QUICK_EMOJIS = ["👀", "👍", "🙌", "✅"];

interface MessageHoverToolbarProps {
  onReaction: (emoji: string) => void;
  onReplyInThread?: () => void;
  /**
   * Slot for the "Properties" entry point — typically a PropertySelector
   * wrapping a Tags button. When omitted, nothing is rendered for properties.
   */
  propertiesSlot?: ReactNode;
  /** Called when Forward icon is clicked. Only rendered when forwardable is true. */
  onForward?: () => void;
  /** Called when Select icon is clicked. Only rendered when forwardable is true. */
  onSelect?: () => void;
  /** Controls visibility of Forward + Select buttons. */
  forwardable?: boolean;
}

export function MessageHoverToolbar({
  onReaction,
  onReplyInThread,
  propertiesSlot,
  onForward,
  onSelect,
  forwardable,
}: MessageHoverToolbarProps) {
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);

  const handleEmojiSelect = (emoji: string) => {
    onReaction(emoji);
    setEmojiPickerOpen(false);
  };

  return (
    <TooltipProvider>
      <div
        className={cn(
          "absolute -top-3 right-8 z-10",
          "flex items-center gap-0.5 px-1 py-0.5",
          "rounded-md border bg-background shadow-sm",
        )}
      >
        {QUICK_EMOJIS.map((emoji) => (
          <Tooltip key={emoji}>
            <TooltipTrigger asChild>
              <button
                onClick={() => onReaction(emoji)}
                className="flex items-center justify-center w-7 h-7 rounded hover:bg-muted transition-colors text-sm"
              >
                {emoji}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={4}>
              {emoji}
            </TooltipContent>
          </Tooltip>
        ))}

        <Popover open={emojiPickerOpen} onOpenChange={setEmojiPickerOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <button className="flex items-center justify-center w-7 h-7 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
                  <SmilePlus size={16} />
                </button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={4}>
              Add reaction
            </TooltipContent>
          </Tooltip>
          <PopoverContent
            side="top"
            align="end"
            sideOffset={8}
            className="w-auto p-0 border-none shadow-lg"
          >
            <EmojiPicker onSelect={handleEmojiSelect} />
          </PopoverContent>
        </Popover>

        {propertiesSlot && (
          <>
            <div className="w-px h-4 bg-border mx-0.5" />
            {propertiesSlot}
          </>
        )}

        {onReplyInThread && (
          <>
            <div className="w-px h-4 bg-border mx-0.5" />
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={onReplyInThread}
                  className="flex items-center justify-center w-7 h-7 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                >
                  <MessageSquare size={16} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={4}>
                Reply in thread
              </TooltipContent>
            </Tooltip>
          </>
        )}

        {forwardable && (onForward || onSelect) && (
          <div className="w-px h-4 bg-border mx-0.5" />
        )}

        {forwardable && onForward && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onForward}
                aria-label="Forward"
                className="flex items-center justify-center w-7 h-7 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              >
                <Forward size={16} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={4}>
              Forward
            </TooltipContent>
          </Tooltip>
        )}

        {forwardable && onSelect && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onSelect}
                aria-label="Select"
                className="flex items-center justify-center w-7 h-7 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              >
                <CheckSquare size={16} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={4}>
              Select
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  );
}

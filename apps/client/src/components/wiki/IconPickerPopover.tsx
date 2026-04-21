import { useState } from "react";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { EmojiPicker } from "@/components/channel/editor/EmojiPicker";
import { cn } from "@/lib/utils";

export interface IconPickerPopoverProps {
  /** Current emoji character (or `undefined` when no icon has been set). */
  value?: string;
  /**
   * Fired when the user picks an emoji. The parent is expected to fold the
   * value into `frontmatter.icon`. We never emit an empty string — the
   * EmojiPicker only fires on a positive selection.
   */
  onChange: (icon: string) => void;
  /**
   * Disables the trigger button entirely and prevents the popover from
   * opening. Used for read-only viewers (permission === "read").
   */
  disabled?: boolean;
}

/**
 * Tiny trigger button that opens the shared `EmojiPicker` from the chat
 * editor. Displays the current icon (or a neutral placeholder) and wires
 * selection back up to the caller.
 *
 * We deliberately keep this a dumb pass-through: no icon-clearing, no
 * "recently used" tracking of its own. `frontmatter.icon` is the single
 * source of truth and the chat editor's picker already caches recents.
 */
export function IconPickerPopover({
  value,
  onChange,
  disabled = false,
}: IconPickerPopoverProps) {
  const [open, setOpen] = useState(false);

  const handleSelect = (emoji: string) => {
    onChange(emoji);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={disabled ? undefined : setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Choose page icon"
          data-testid="wiki-icon-picker-trigger"
          disabled={disabled}
          className={cn(
            "inline-flex items-center justify-center w-9 h-9 rounded-md border border-border bg-background text-lg",
            "hover:bg-muted transition-colors",
            "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-background",
          )}
        >
          <span aria-hidden="true">
            {value && value.length > 0 ? value : "📄"}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        className="w-auto p-0 border-none shadow-lg"
        data-testid="wiki-icon-picker-content"
      >
        <EmojiPicker onSelect={handleSelect} />
      </PopoverContent>
    </Popover>
  );
}

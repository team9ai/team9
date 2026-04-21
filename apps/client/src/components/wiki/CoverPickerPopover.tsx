import { useEffect, useState } from "react";
import { ImageIcon, Trash2 } from "lucide-react";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface CoverPickerPopoverProps {
  /** Wiki id — reserved for Task 22 upload wiring. Not consumed yet. */
  wikiId: string;
  /** Current cover path (folder9-relative), or `undefined` when unset. */
  value?: string;
  /**
   * Fired when the user applies a new cover path, or `""` to clear it. The
   * caller is expected to fold the value into `frontmatter.cover`; a string
   * of length 0 is the explicit "remove" signal.
   */
  onChange: (coverPath: string) => void;
  /**
   * Disables the trigger button and prevents the popover from opening —
   * used for read-only viewers.
   */
  disabled?: boolean;
}

/**
 * MVP cover picker.
 *
 * The real upload flow lives in Task 22. For now, we expose a single text
 * input that lets the user paste an already-uploaded asset path (folder9
 * understands workspace-relative paths directly) plus a "Remove" button.
 * Applying commits the draft via `onChange`.
 *
 * Why a text field? File uploads require the file-keeper flow (attachments
 * directory, JWT scope) which is out of scope for Task 18. A text entry is
 * enough for power users to wire an existing image until that plumbing
 * exists. Task 22 replaces this with a real uploader while keeping the
 * component API (`value`, `onChange`, `disabled`) stable.
 */
export function CoverPickerPopover({
  wikiId: _wikiId,
  value,
  onChange,
  disabled = false,
}: CoverPickerPopoverProps) {
  const [open, setOpen] = useState(false);
  const [draftPath, setDraftPath] = useState(value ?? "");

  // When the popover re-opens, re-seed the draft from the current value so
  // the input always reflects what's saved. We can't trust `value` to stay
  // the same between opens — the parent may have applied a change from
  // elsewhere (e.g. draft reconciliation on remount).
  useEffect(() => {
    if (open) setDraftPath(value ?? "");
  }, [open, value]);

  const handleApply = () => {
    onChange(draftPath.trim());
    setOpen(false);
  };

  const handleRemove = () => {
    onChange("");
    setOpen(false);
  };

  const hasCover = typeof value === "string" && value.length > 0;

  return (
    <Popover open={open} onOpenChange={disabled ? undefined : setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={hasCover ? "Change page cover" : "Add page cover"}
          data-testid="wiki-cover-picker-trigger"
          disabled={disabled}
          className={cn(
            "inline-flex items-center gap-1.5 px-2.5 h-9 rounded-md border border-border bg-background text-sm",
            "hover:bg-muted transition-colors text-muted-foreground",
            "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-background",
          )}
        >
          <ImageIcon size={14} />
          <span>{hasCover ? "Change cover" : "Add cover"}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={8} className="w-80">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="wiki-cover-path-input"
              className="text-xs font-medium text-muted-foreground"
            >
              Cover image path
            </label>
            <Input
              id="wiki-cover-path-input"
              data-testid="wiki-cover-path-input"
              placeholder="attachments/cover.jpg"
              value={draftPath}
              onChange={(e) => setDraftPath(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              Paste a folder9 path. Uploads arrive in a future release.
            </p>
          </div>
          <div className="flex items-center justify-between">
            {hasCover ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleRemove}
                data-testid="wiki-cover-remove"
              >
                <Trash2 size={14} className="mr-1" /> Remove
              </Button>
            ) : (
              <span />
            )}
            <Button
              type="button"
              size="sm"
              onClick={handleApply}
              data-testid="wiki-cover-apply"
            >
              Apply
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

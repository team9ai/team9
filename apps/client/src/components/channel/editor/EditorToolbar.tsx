import { useState, useRef } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getSelection, $isRangeSelection } from "lexical";
import { Smile, Plus, AtSign, Search, ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { EmojiPicker } from "./EmojiPicker";
import { cn } from "@/lib/utils";
import { $createTextNode, $insertNodes } from "lexical";

interface EditorToolbarProps {
  channelId?: string;
  onFileSelect?: (files: FileList) => void;
  isBotDm?: boolean;
  isDeepResearch?: boolean;
  onToggleDeepResearch?: () => void;
}

export function EditorToolbar({
  onFileSelect,
  isBotDm = false,
  isDeepResearch = false,
  onToggleDeepResearch,
}: EditorToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [editor] = useLexicalComposerContext();
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  const insertEmoji = (emoji: string) => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        selection.insertText(emoji);
      } else {
        const textNode = $createTextNode(emoji);
        $insertNodes([textNode]);
      }
    });
    setShowEmojiPicker(false);
    editor.focus();
  };

  const insertMention = () => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        selection.insertText("@");
      } else {
        const textNode = $createTextNode("@");
        $insertNodes([textNode]);
      }
    });
    editor.focus();
  };

  const handleFileClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0 && onFileSelect) {
      onFileSelect(files);
    }
    // Reset input so same file can be selected again
    e.target.value = "";
  };

  const toolbarBtnClass =
    "h-8 w-8 p-0 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/80";

  const aiBtnClass =
    "group h-8 w-8 hover:w-auto p-0 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-all duration-200 overflow-hidden";

  return (
    <div className="flex items-center gap-1">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={handleFileChange}
        className="hidden"
        accept="*/*"
      />

      {onFileSelect && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleFileClick}
          className={toolbarBtnClass}
          title="Attach file"
        >
          <Plus size={16} />
        </Button>
      )}

      <Popover open={showEmojiPicker} onOpenChange={setShowEmojiPicker}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={toolbarBtnClass}
            title="Emoji"
          >
            <Smile size={16} />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-auto p-0 border-0"
          side="top"
          align="start"
        >
          <EmojiPicker onSelect={insertEmoji} />
        </PopoverContent>
      </Popover>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={insertMention}
        className={toolbarBtnClass}
        title="Mention (@)"
      >
        <AtSign size={16} />
      </Button>

      {isBotDm && (
        <>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-pressed={isDeepResearch}
            className={cn(
              isDeepResearch
                ? "h-8 px-3 rounded-full bg-[#2f67ff] text-white hover:bg-[#2f67ff]/90 hover:text-white shadow-[0_6px_16px_rgba(47,103,255,0.28)]"
                : cn(aiBtnClass, "group/ai"),
            )}
            title="Deep research"
            onClick={onToggleDeepResearch}
          >
            <Search size={16} className="shrink-0" />
            <span
              className={cn(
                "text-xs whitespace-nowrap",
                isDeepResearch
                  ? "ml-1.5"
                  : "max-w-0 opacity-0 group-hover/ai:max-w-32 group-hover/ai:opacity-100 group-hover/ai:ml-1 group-hover/ai:mr-1 transition-all duration-200",
              )}
            >
              Deep research
            </span>
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(aiBtnClass, "group/ai2")}
            title="Generate image"
          >
            <ImagePlus size={16} className="shrink-0" />
            <span className="max-w-0 opacity-0 group-hover/ai2:max-w-36 group-hover/ai2:opacity-100 group-hover/ai2:ml-1 group-hover/ai2:mr-1 transition-all duration-200 text-xs whitespace-nowrap">
              Generate image
            </span>
          </Button>
        </>
      )}
    </div>
  );
}

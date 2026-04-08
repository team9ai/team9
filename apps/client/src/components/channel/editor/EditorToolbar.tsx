import { useState, useRef } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getSelection, $isRangeSelection } from "lexical";
import { Smile, Paperclip, AtSign, Search, ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { EmojiPicker } from "./EmojiPicker";
import { $createTextNode, $insertNodes } from "lexical";

interface EditorToolbarProps {
  onFileSelect?: (files: FileList) => void;
  isBotDm?: boolean;
}

export function EditorToolbar({
  onFileSelect,
  isBotDm = false,
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

  const aiPillClass =
    "h-8 px-3 rounded-full border border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted/60 gap-1.5 text-xs font-medium";

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
          <Paperclip size={16} />
        </Button>
      )}

      {isBotDm && (
        <>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={aiPillClass}
            title="Deep research"
          >
            <Search size={14} />
            <span>Deep research</span>
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={aiPillClass}
            title="Generate image"
          >
            <ImagePlus size={14} />
            <span>Generate image</span>
          </Button>
        </>
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
    </div>
  );
}

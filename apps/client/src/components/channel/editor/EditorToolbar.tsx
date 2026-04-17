import { useState, useRef } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getSelection, $isRangeSelection } from "lexical";
import { Smile, Plus, AtSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { EmojiPicker } from "./EmojiPicker";
import { $createTextNode, $insertNodes } from "lexical";

interface EditorToolbarProps {
  channelId?: string;
  onFileSelect?: (files: FileList) => void;
  // Deep research / generate image entries temporarily hidden
  isBotDm?: boolean;
  isDeepResearch?: boolean;
  onToggleDeepResearch?: () => void;
}

export function EditorToolbar({ onFileSelect }: EditorToolbarProps) {
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

      {/* Deep research / generate image entries temporarily hidden */}
    </div>
  );
}

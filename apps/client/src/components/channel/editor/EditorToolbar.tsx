import { useCallback, useEffect, useState, useRef } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getSelection,
  $isRangeSelection,
  FORMAT_TEXT_COMMAND,
  SELECTION_CHANGE_COMMAND,
  COMMAND_PRIORITY_CRITICAL,
} from "lexical";
import {
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  REMOVE_LIST_COMMAND,
  $isListNode,
  ListNode,
} from "@lexical/list";
import { $getNearestNodeOfType, mergeRegister } from "@lexical/utils";
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Smile,
  Paperclip,
} from "lucide-react";
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
  onFileSelect?: (files: FileList) => void;
}

export function EditorToolbar({ onFileSelect }: EditorToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [editor] = useLexicalComposerContext();
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [listType, setListType] = useState<"bullet" | "number" | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  const updateToolbar = useCallback(() => {
    const selection = $getSelection();
    if ($isRangeSelection(selection)) {
      setIsBold(selection.hasFormat("bold"));
      setIsItalic(selection.hasFormat("italic"));

      const anchorNode = selection.anchor.getNode();
      const element =
        anchorNode.getKey() === "root"
          ? anchorNode
          : anchorNode.getTopLevelElementOrThrow();
      const elementDOM = editor.getElementByKey(element.getKey());

      if (elementDOM !== null) {
        const parentList = $getNearestNodeOfType(anchorNode, ListNode);
        if ($isListNode(parentList)) {
          const type = parentList.getListType();
          setListType(type === "number" ? "number" : "bullet");
        } else {
          setListType(null);
        }
      }
    }
  }, [editor]);

  useEffect(() => {
    return mergeRegister(
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
          updateToolbar();
        });
      }),
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => {
          updateToolbar();
          return false;
        },
        COMMAND_PRIORITY_CRITICAL,
      ),
    );
  }, [editor, updateToolbar]);

  const formatBold = () => {
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold");
  };

  const formatItalic = () => {
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic");
  };

  const formatBulletList = () => {
    if (listType === "bullet") {
      editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
    } else {
      editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
    }
  };

  const formatNumberedList = () => {
    if (listType === "number") {
      editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
    } else {
      editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);
    }
  };

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

  return (
    <div className="flex items-center gap-1 mb-2 pb-2 border-b border-border">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={handleFileChange}
        className="hidden"
        accept="*/*"
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={formatBold}
        className={cn("h-8 w-8 p-0", isBold && "bg-primary/10 text-primary")}
        title="Bold (Ctrl+B)"
      >
        <Bold size={16} />
      </Button>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={formatItalic}
        className={cn("h-8 w-8 p-0", isItalic && "bg-primary/10 text-primary")}
        title="Italic (Ctrl+I)"
      >
        <Italic size={16} />
      </Button>

      <div className="w-px h-5 bg-muted mx-1" />

      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={formatBulletList}
        className={cn(
          "h-8 w-8 p-0",
          listType === "bullet" && "bg-primary/10 text-primary",
        )}
        title="Bullet List"
      >
        <List size={16} />
      </Button>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={formatNumberedList}
        className={cn(
          "h-8 w-8 p-0",
          listType === "number" && "bg-primary/10 text-primary",
        )}
        title="Numbered List"
      >
        <ListOrdered size={16} />
      </Button>

      <div className="w-px h-5 bg-muted mx-1" />

      <Popover open={showEmojiPicker} onOpenChange={setShowEmojiPicker}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
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

      {onFileSelect && (
        <>
          <div className="w-px h-5 bg-muted mx-1" />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleFileClick}
            className="h-8 w-8 p-0"
            title="Attach file"
          >
            <Paperclip size={16} />
          </Button>
        </>
      )}
    </div>
  );
}

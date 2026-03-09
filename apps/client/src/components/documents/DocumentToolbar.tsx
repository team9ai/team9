import { useCallback, useEffect, useState } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getSelection,
  $isRangeSelection,
  $createParagraphNode,
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
import { $createQuoteNode, $isQuoteNode } from "@lexical/rich-text";
import { $setBlocksType } from "@lexical/selection";
import { Bold, Italic, List, ListOrdered, Code, Quote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function DocumentToolbar() {
  const [editor] = useLexicalComposerContext();
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [isCode, setIsCode] = useState(false);
  const [isQuote, setIsQuote] = useState(false);
  const [listType, setListType] = useState<"bullet" | "number" | null>(null);

  const updateToolbar = useCallback(() => {
    const selection = $getSelection();
    if ($isRangeSelection(selection)) {
      setIsBold(selection.hasFormat("bold"));
      setIsItalic(selection.hasFormat("italic"));
      setIsCode(selection.hasFormat("code"));

      const anchorNode = selection.anchor.getNode();
      const element =
        anchorNode.getKey() === "root"
          ? anchorNode
          : anchorNode.getTopLevelElementOrThrow();
      const elementDOM = editor.getElementByKey(element.getKey());

      if (elementDOM !== null) {
        // Check for list
        const parentList = $getNearestNodeOfType(anchorNode, ListNode);
        if ($isListNode(parentList)) {
          const type = parentList.getListType();
          setListType(type === "number" ? "number" : "bullet");
        } else {
          setListType(null);
        }

        // Check for quote
        setIsQuote($isQuoteNode(element));
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

  const formatCode = () => {
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, "code");
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

  const toggleQuote = () => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        if (isQuote) {
          $setBlocksType(selection, () => $createParagraphNode());
        } else {
          $setBlocksType(selection, () => $createQuoteNode());
        }
      }
    });
  };

  return (
    <div className="flex items-center gap-1 pb-2 border-b border-border">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={formatBold}
        className={cn("h-7 w-7 p-0", isBold && "bg-primary/10 text-primary")}
        title="Bold (Ctrl+B)"
      >
        <Bold size={14} />
      </Button>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={formatItalic}
        className={cn("h-7 w-7 p-0", isItalic && "bg-primary/10 text-primary")}
        title="Italic (Ctrl+I)"
      >
        <Italic size={14} />
      </Button>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={formatCode}
        className={cn("h-7 w-7 p-0", isCode && "bg-primary/10 text-primary")}
        title="Inline Code"
      >
        <Code size={14} />
      </Button>

      <div className="w-px h-5 bg-muted mx-1" />

      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={formatBulletList}
        className={cn(
          "h-7 w-7 p-0",
          listType === "bullet" && "bg-primary/10 text-primary",
        )}
        title="Bullet List"
      >
        <List size={14} />
      </Button>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={formatNumberedList}
        className={cn(
          "h-7 w-7 p-0",
          listType === "number" && "bg-primary/10 text-primary",
        )}
        title="Numbered List"
      >
        <ListOrdered size={14} />
      </Button>

      <div className="w-px h-5 bg-muted mx-1" />

      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={toggleQuote}
        className={cn("h-7 w-7 p-0", isQuote && "bg-primary/10 text-primary")}
        title="Quote"
      >
        <Quote size={14} />
      </Button>
    </div>
  );
}

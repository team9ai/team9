import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
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
import {
  $createHeadingNode,
  $createQuoteNode,
  $isQuoteNode,
} from "@lexical/rich-text";
import { $setBlocksType } from "@lexical/selection";
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Code,
  Quote,
  GripVertical,
  Heading1,
  Heading2,
  Heading3,
  Type,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface OverlayPosition {
  x: number;
  y: number;
}

interface OverlayState {
  toolbar: OverlayPosition | null;
  block: OverlayPosition | null;
  blockMenu: OverlayPosition | null;
}

export function DocumentFormattingOverlay() {
  const [editor] = useLexicalComposerContext();
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [isCode, setIsCode] = useState(false);
  const [isQuote, setIsQuote] = useState(false);
  const [listType, setListType] = useState<"bullet" | "number" | null>(null);
  const [blockMenuOpen, setBlockMenuOpen] = useState(false);
  const [overlay, setOverlay] = useState<OverlayState>({
    toolbar: null,
    block: null,
    blockMenu: null,
  });

  const updateToolbar = useCallback(() => {
    const selection = $getSelection();
    const rootElement = editor.getRootElement();
    if (!rootElement) {
      setOverlay({ toolbar: null, block: null, blockMenu: null });
      return;
    }

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

      const rootRect = rootElement.getBoundingClientRect();
      const blockRect = elementDOM?.getBoundingClientRect();
      const block =
        elementDOM && blockRect
          ? {
              x: rootRect.left - 28,
              y: blockRect.top + Math.max(0, (blockRect.height - 20) / 2),
            }
          : null;
      const blockMenu =
        elementDOM && blockRect
          ? {
              x: rootRect.left - 4,
              y: blockRect.top + Math.max(0, (blockRect.height - 20) / 2),
            }
          : null;

      const nativeSelection = window.getSelection();
      const range =
        nativeSelection && nativeSelection.rangeCount > 0
          ? nativeSelection.getRangeAt(0)
          : null;
      const selectedText = nativeSelection?.toString().trim() ?? "";
      const selectionRect = range?.getBoundingClientRect();
      const hasVisibleSelection =
        selectedText.length > 0 &&
        !selection.isCollapsed() &&
        selectionRect !== undefined &&
        selectionRect.width > 0 &&
        selectionRect.height > 0;
      const toolbar =
        hasVisibleSelection && selectionRect
          ? {
              x: Math.min(
                window.innerWidth - 160,
                Math.max(160, selectionRect.left + selectionRect.width / 2),
              ),
              y:
                selectionRect.top > 56
                  ? selectionRect.top - 48
                  : selectionRect.bottom + 8,
            }
          : null;

      setOverlay({ toolbar, block, blockMenu });
      return;
    }

    setOverlay({ toolbar: null, block: null, blockMenu: null });
  }, [editor]);

  useEffect(() => {
    if (!overlay.block) setBlockMenuOpen(false);
  }, [overlay.block]);

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
          window.requestAnimationFrame(() => {
            editor.getEditorState().read(updateToolbar);
          });
          return false;
        },
        COMMAND_PRIORITY_CRITICAL,
      ),
      editor.registerRootListener((rootElement, previousRootElement) => {
        const handleRootEvent = () => {
          window.requestAnimationFrame(() => {
            editor.getEditorState().read(updateToolbar);
          });
        };

        previousRootElement?.removeEventListener("keyup", handleRootEvent);
        previousRootElement?.removeEventListener("mouseup", handleRootEvent);
        previousRootElement?.removeEventListener("focus", handleRootEvent);
        previousRootElement?.removeEventListener("blur", handleRootEvent);

        rootElement?.addEventListener("keyup", handleRootEvent);
        rootElement?.addEventListener("mouseup", handleRootEvent);
        rootElement?.addEventListener("focus", handleRootEvent);
        rootElement?.addEventListener("blur", handleRootEvent);

        return () => {
          rootElement?.removeEventListener("keyup", handleRootEvent);
          rootElement?.removeEventListener("mouseup", handleRootEvent);
          rootElement?.removeEventListener("focus", handleRootEvent);
          rootElement?.removeEventListener("blur", handleRootEvent);
        };
      }),
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

  const toggleBlockMenu = () => {
    setBlockMenuOpen((open) => !open);
    editor.focus();
  };

  const applyParagraph = () => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        $setBlocksType(selection, () => $createParagraphNode());
      }
    });
    setBlockMenuOpen(false);
    editor.focus();
  };

  const applyHeading = (level: "h1" | "h2" | "h3") => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        $setBlocksType(selection, () => $createHeadingNode(level));
      }
    });
    setBlockMenuOpen(false);
    editor.focus();
  };

  const applyQuote = () => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        $setBlocksType(selection, () => $createQuoteNode());
      }
    });
    setBlockMenuOpen(false);
    editor.focus();
  };

  const applyBulletList = () => {
    editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
    setBlockMenuOpen(false);
    editor.focus();
  };

  const applyNumberedList = () => {
    editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);
    setBlockMenuOpen(false);
    editor.focus();
  };

  const keepSelection = (event: React.MouseEvent) => {
    event.preventDefault();
  };

  return (
    <>
      {overlay.block &&
        createPortal(
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onMouseDown={keepSelection}
            onClick={toggleBlockMenu}
            className="fixed z-[1000] h-5 w-5 p-0 rounded text-muted-foreground/70 hover:bg-muted/60 hover:text-foreground"
            style={{ left: overlay.block.x, top: overlay.block.y }}
            title="Block actions"
            data-testid="document-block-insert-button"
          >
            <GripVertical size={14} />
          </Button>,
          document.body,
        )}
      {overlay.blockMenu &&
        blockMenuOpen &&
        createPortal(
          <div
            className="fixed z-[1000] w-44 rounded-md border border-border bg-popover p-1 text-sm text-popover-foreground shadow-md"
            style={{
              left: overlay.blockMenu.x,
              top: overlay.blockMenu.y,
            }}
            data-testid="document-block-menu"
          >
            <button
              type="button"
              onMouseDown={(event) => {
                keepSelection(event);
                applyParagraph();
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-muted"
            >
              <Type size={14} />
              Text
            </button>
            <button
              type="button"
              onMouseDown={(event) => {
                keepSelection(event);
                applyHeading("h1");
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-muted"
            >
              <Heading1 size={14} />
              Heading 1
            </button>
            <button
              type="button"
              onMouseDown={(event) => {
                keepSelection(event);
                applyHeading("h2");
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-muted"
            >
              <Heading2 size={14} />
              Heading 2
            </button>
            <button
              type="button"
              onMouseDown={(event) => {
                keepSelection(event);
                applyHeading("h3");
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-muted"
            >
              <Heading3 size={14} />
              Heading 3
            </button>
            <button
              type="button"
              onMouseDown={(event) => {
                keepSelection(event);
                applyQuote();
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-muted"
            >
              <Quote size={14} />
              Quote
            </button>
            <button
              type="button"
              onMouseDown={(event) => {
                keepSelection(event);
                applyBulletList();
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-muted"
            >
              <List size={14} />
              Bullet list
            </button>
            <button
              type="button"
              onMouseDown={(event) => {
                keepSelection(event);
                applyNumberedList();
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-muted"
            >
              <ListOrdered size={14} />
              Numbered list
            </button>
          </div>,
          document.body,
        )}
      {overlay.toolbar &&
        createPortal(
          <div
            className="fixed z-[1000] flex items-center gap-1 rounded-md border border-border bg-popover px-1 py-1 text-popover-foreground shadow-md"
            style={{
              left: overlay.toolbar.x,
              top: overlay.toolbar.y,
              transform: "translateX(-50%)",
            }}
            data-testid="document-floating-toolbar"
          >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onMouseDown={keepSelection}
              onClick={formatBold}
              className={cn(
                "h-7 w-7 p-0",
                isBold && "bg-primary/10 text-primary",
              )}
              title="Bold (Ctrl+B)"
            >
              <Bold size={14} />
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              onMouseDown={keepSelection}
              onClick={formatItalic}
              className={cn(
                "h-7 w-7 p-0",
                isItalic && "bg-primary/10 text-primary",
              )}
              title="Italic (Ctrl+I)"
            >
              <Italic size={14} />
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              onMouseDown={keepSelection}
              onClick={formatCode}
              className={cn(
                "h-7 w-7 p-0",
                isCode && "bg-primary/10 text-primary",
              )}
              title="Inline Code"
            >
              <Code size={14} />
            </Button>

            <div className="w-px h-5 bg-muted mx-1" />

            <Button
              type="button"
              variant="ghost"
              size="sm"
              onMouseDown={keepSelection}
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
              onMouseDown={keepSelection}
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
              onMouseDown={keepSelection}
              onClick={toggleQuote}
              className={cn(
                "h-7 w-7 p-0",
                isQuote && "bg-primary/10 text-primary",
              )}
              title="Quote"
            >
              <Quote size={14} />
            </Button>
          </div>,
          document.body,
        )}
    </>
  );
}

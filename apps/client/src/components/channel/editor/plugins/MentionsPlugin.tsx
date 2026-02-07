import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_TAB_COMMAND,
  TextNode,
} from "lexical";
import { mergeRegister } from "@lexical/utils";
import { useSearchUsers } from "@/hooks/useIMUsers";
import { $createMentionNode } from "../nodes/MentionNode";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { IMUser } from "@/types/im";

const PUNCTUATION =
  "\\.,\\+\\*\\?\\$\\@\\|#{}\\(\\)\\^\\-\\[\\]\\\\!%'\"~=<>_:;";
const TRIGGERS = ["@"].join("");
const VALID_CHARS = `[^${TRIGGERS}${PUNCTUATION}\\s]`;
const LENGTH_LIMIT = 75;

const MentionRegex = new RegExp(
  `(^|\\s|\\()([${TRIGGERS}]((?:${VALID_CHARS}){0,${LENGTH_LIMIT}}))$`,
);

function useMentionLookupService(mentionString: string | null) {
  // Enable query when mentionString is not null (including empty string for showing all users)
  const { data: users = [], isLoading } = useSearchUsers(
    mentionString ?? "",
    mentionString !== null,
  );

  return { users, isLoading };
}

interface MentionSuggestionsProps {
  suggestions: IMUser[];
  selectedIndex: number;
  onSelect: (user: IMUser) => void;
  onHover: (index: number) => void;
  isLoading?: boolean;
  position?: { left: number; bottom: number };
}

function MentionSuggestions({
  suggestions,
  selectedIndex,
  onSelect,
  onHover,
  isLoading,
  position,
}: MentionSuggestionsProps) {
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);

  // Auto-scroll selected item into view for keyboard navigation
  useEffect(() => {
    itemRefs.current[selectedIndex]?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  return (
    <div
      className="absolute w-64 max-h-60 overflow-y-auto bg-background border border-border rounded-lg shadow-lg z-9999"
      style={
        position
          ? { left: position.left, bottom: position.bottom }
          : { left: 0, bottom: "100%" }
      }
    >
      {isLoading ? (
        <div className="px-3 py-2 text-sm text-muted-foreground">
          Loading...
        </div>
      ) : suggestions.length === 0 ? (
        <div className="px-3 py-2 text-sm text-muted-foreground">
          No users found
        </div>
      ) : (
        <ul className="py-1">
          {suggestions.map((user, index) => (
            <li
              key={user.id}
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              className={cn(
                "flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors",
                selectedIndex === index
                  ? "bg-primary/10 text-primary"
                  : "hover:bg-muted",
              )}
              onClick={() => onSelect(user)}
              onMouseEnter={() => onHover(index)}
            >
              <Avatar className="w-6 h-6">
                {user.avatarUrl && <AvatarImage src={user.avatarUrl} />}
                <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                  {(user.displayName || user.username)[0].toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {user.displayName || user.username}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  @{user.username}
                </p>
              </div>
              {user.status === "online" && (
                <div className="w-2 h-2 bg-success rounded-full" />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function MentionsPlugin() {
  const [editor] = useLexicalComposerContext();
  const [queryString, setQueryString] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [popupPosition, setPopupPosition] = useState<{
    left: number;
    bottom: number;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dismissedRef = useRef(false);

  const { users, isLoading } = useMentionLookupService(queryString);

  const suggestions = useMemo(() => {
    return users.slice(0, 10);
  }, [users]);

  const showDropdown = queryString !== null;

  const updatePopupPosition = useCallback(() => {
    const domSelection = window.getSelection();
    if (!domSelection || domSelection.rangeCount === 0 || !containerRef.current)
      return;

    const range = domSelection.getRangeAt(0);
    const caretRect = range.getBoundingClientRect();
    const containerRect =
      containerRef.current.parentElement?.getBoundingClientRect();
    if (!containerRect) return;

    setPopupPosition({
      left: Math.max(0, caretRect.left - containerRect.left),
      bottom: containerRect.bottom - caretRect.top + 4,
    });
  }, []);

  const checkForMentionMatch = useCallback(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
      setQueryString(null);
      return null;
    }

    const anchor = selection.anchor;
    const anchorNode = anchor.getNode();

    if (!$isTextNode(anchorNode)) {
      setQueryString(null);
      return null;
    }

    const text = anchorNode.getTextContent().slice(0, anchor.offset);
    const match = MentionRegex.exec(text);

    if (match) {
      if (dismissedRef.current) {
        return null;
      }
      const mentionString = match[3] || "";
      setQueryString(mentionString);
      // Calculate popup position based on caret
      setTimeout(updatePopupPosition, 0);
      return {
        leadOffset: match.index + match[1].length,
        matchingString: mentionString,
        replaceableString: match[2],
      };
    }

    setQueryString(null);
    return null;
  }, [updatePopupPosition]);

  const insertMention = useCallback(
    (user: IMUser) => {
      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;

        const anchor = selection.anchor;
        const anchorNode = anchor.getNode();

        if (!$isTextNode(anchorNode)) return;

        const text = anchorNode.getTextContent().slice(0, anchor.offset);
        const match = MentionRegex.exec(text);

        if (!match) return;

        const mentionNode = $createMentionNode(
          user.id,
          user.displayName || user.username,
        );

        const startOffset = match.index + match[1].length;
        const endOffset = anchor.offset;

        // Split the text node and insert mention
        const [, afterNode] = anchorNode.splitText(startOffset, endOffset);

        if (afterNode) {
          afterNode.remove();
        }

        const targetNode = anchorNode.getNextSibling() || anchorNode;

        if (targetNode === anchorNode) {
          // Insert at the end of the current node
          anchorNode.setTextContent(text.slice(0, startOffset));
          anchorNode.insertAfter(mentionNode);
        } else {
          targetNode.insertBefore(mentionNode);
        }

        // Insert a space after the mention
        const spaceNode = new TextNode(" ");
        mentionNode.insertAfter(spaceNode);
        spaceNode.select();
      });

      setQueryString(null);
      setSelectedIndex(0);
    },
    [editor],
  );

  useEffect(() => {
    let prevText = "";

    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const currentText = $getRoot().getTextContent();
        if (currentText !== prevText) {
          prevText = currentText;
          dismissedRef.current = false;
        }

        checkForMentionMatch();
      });
    });
  }, [editor, checkForMentionMatch]);

  useEffect(() => {
    if (!showDropdown) return;

    return mergeRegister(
      editor.registerCommand(
        KEY_ARROW_DOWN_COMMAND,
        (event) => {
          if (suggestions.length === 0) return false;
          event?.preventDefault();
          setSelectedIndex((prev) =>
            prev < suggestions.length - 1 ? prev + 1 : 0,
          );
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_ARROW_UP_COMMAND,
        (event) => {
          if (suggestions.length === 0) return false;
          event?.preventDefault();
          setSelectedIndex((prev) =>
            prev > 0 ? prev - 1 : suggestions.length - 1,
          );
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (event) => {
          if (suggestions.length > 0) {
            event?.preventDefault();
            insertMention(suggestions[selectedIndex]);
            return true;
          }
          return false;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_TAB_COMMAND,
        (event) => {
          if (suggestions.length > 0) {
            event?.preventDefault();
            insertMention(suggestions[selectedIndex]);
            return true;
          }
          return false;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_ESCAPE_COMMAND,
        () => {
          dismissedRef.current = true;
          setQueryString(null);
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
    );
  }, [editor, showDropdown, suggestions, selectedIndex, insertMention]);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!showDropdown) return;

    const handleMouseDown = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        dismissedRef.current = true;
        setQueryString(null);
      }
    };

    document.addEventListener("mousedown", handleMouseDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
    };
  }, [showDropdown]);

  // Reset selected index when suggestions change
  useEffect(() => {
    setSelectedIndex(0);
  }, [suggestions]);

  if (!showDropdown) {
    return null;
  }

  return (
    <div ref={containerRef} className="relative">
      <MentionSuggestions
        suggestions={suggestions}
        selectedIndex={selectedIndex}
        onSelect={insertMention}
        onHover={setSelectedIndex}
        isLoading={isLoading}
        position={popupPosition ?? undefined}
      />
    </div>
  );
}

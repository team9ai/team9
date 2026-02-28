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
import { useTranslation } from "react-i18next";
import { useSearchUsers } from "@/hooks/useIMUsers";
import { OnlineStatusDot } from "@/components/ui/online-status-dot";
import {
  useChannel,
  useChannelMembers,
  useAddChannelMember,
} from "@/hooks/useChannels";
import { useUser } from "@/stores";
import { $createMentionNode } from "../nodes/MentionNode";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
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
              <OnlineStatusDot userId={user.id} className="w-2 h-2" />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface MentionsPluginProps {
  channelId?: string;
}

export function MentionsPlugin({ channelId }: MentionsPluginProps) {
  const [editor] = useLexicalComposerContext();
  const { t } = useTranslation("channel");
  const [queryString, setQueryString] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [popupPosition, setPopupPosition] = useState<{
    left: number;
    bottom: number;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dismissedRef = useRef(false);

  // Bot membership check state
  const [botToAdd, setBotToAdd] = useState<IMUser | null>(null);

  // Channel context for bot membership check
  const { data: channel } = useChannel(channelId);
  const { data: members = [] } = useChannelMembers(channelId);
  const currentUser = useUser();
  const addMember = useAddChannelMember(channelId ?? "");

  const isGroupChannel =
    channel?.type === "public" || channel?.type === "private";

  const currentUserRole = useMemo(() => {
    if (!currentUser || !members.length) return "member";
    const membership = members.find((m) => m.userId === currentUser.id);
    return membership?.role || "member";
  }, [members, currentUser]);

  const canAddMembers =
    channel?.type === "public" ||
    currentUserRole === "owner" ||
    currentUserRole === "admin";

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
    const containerRect = containerRef.current.getBoundingClientRect();

    setPopupPosition({
      left: Math.max(0, caretRect.left - containerRect.left),
      bottom: containerRect.bottom - caretRect.top,
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
          user.userType,
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

  // Handle user selection with bot membership check
  const handleSelectUser = useCallback(
    (user: IMUser) => {
      // Only check bot membership in group channels
      if (isGroupChannel && user.userType === "bot") {
        const isMember = members.some((m) => m.userId === user.id);
        if (!isMember) {
          setBotToAdd(user);
          setQueryString(null);
          setSelectedIndex(0);
          return;
        }
      }
      insertMention(user);
    },
    [isGroupChannel, members, insertMention],
  );

  // Handle adding bot to channel then inserting mention
  const handleAddBot = useCallback(() => {
    if (!botToAdd || !channelId) return;
    const bot = botToAdd;
    addMember.mutate(
      { userId: bot.id },
      {
        onSuccess: () => {
          setBotToAdd(null);
          insertMention(bot);
        },
      },
    );
  }, [botToAdd, channelId, addMember, insertMention]);

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
            handleSelectUser(suggestions[selectedIndex]);
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
            handleSelectUser(suggestions[selectedIndex]);
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
  }, [editor, showDropdown, suggestions, selectedIndex, handleSelectUser]);

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

  const botName = botToAdd?.displayName || botToAdd?.username || "Bot";
  const dialogDescription = (() => {
    if (!botToAdd) return "";
    if (channel?.type === "public") {
      return t("botNotMemberPublicDesc", { botName });
    }
    if (canAddMembers) {
      return t("botNotMemberPrivateAdminDesc", { botName });
    }
    return t("botNotMemberPrivateDesc", { botName });
  })();

  return (
    <>
      {showDropdown && (
        <div ref={containerRef} className="relative">
          <MentionSuggestions
            suggestions={suggestions}
            selectedIndex={selectedIndex}
            onSelect={handleSelectUser}
            onHover={setSelectedIndex}
            isLoading={isLoading}
            position={popupPosition ?? undefined}
          />
        </div>
      )}

      <AlertDialog
        open={!!botToAdd}
        onOpenChange={(open) => {
          if (!open) setBotToAdd(null);
        }}
      >
        <AlertDialogContent>
          <div className="flex flex-col items-center gap-3 pt-2 pb-1">
            <Avatar className="w-14 h-14">
              {botToAdd?.avatarUrl ? (
                <AvatarImage src={botToAdd.avatarUrl} alt={botName} />
              ) : (
                <AvatarImage src="/bot.webp" alt={botName} />
              )}
              <AvatarFallback className="bg-primary text-primary-foreground text-lg">
                {botName[0].toUpperCase()}
              </AvatarFallback>
            </Avatar>
          </div>
          <AlertDialogHeader className="text-center sm:text-center">
            <AlertDialogTitle>
              {t("botNotMemberTitle", { botName })}
            </AlertDialogTitle>
            <AlertDialogDescription>{dialogDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            {canAddMembers ? (
              <>
                <AlertDialogCancel>
                  {t("cancel", { ns: "common" })}
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleAddBot}
                  disabled={addMember.isPending}
                >
                  {addMember.isPending ? t("addingBot") : t("addBotToChannel")}
                </AlertDialogAction>
              </>
            ) : (
              <AlertDialogAction onClick={() => setBotToAdd(null)}>
                {t("confirm", { ns: "common" })}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { Loader2, File, Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useChannelMessages, useSendMessage } from "@/hooks/useMessages";
import { useSyncChannel } from "@/hooks/useSyncChannel";
import {
  useChannel,
  useMarkAsRead,
  useChannelMembers,
} from "@/hooks/useChannels";
import { useUser } from "@/stores";
import { useThreadStore } from "@/hooks/useThread";
import { useBotStartupCountdown } from "@/hooks/useBotStartupCountdown";
import { useEffectOncePerKey } from "@/hooks/useEffectOncePerKey";
import wsService from "@/services/websocket";
import { ChannelContent } from "./ChannelContent";
import { ChannelHeader } from "./ChannelHeader";
import { ChannelTabs } from "./ChannelTabs";
import { ThreadPanel } from "./ThreadPanel";
import { JoinChannelPrompt } from "./JoinChannelPrompt";
import { BotStartupOverlay } from "./BotStartupOverlay";
import { BotInstanceStoppedBanner } from "./BotInstanceStoppedBanner";
import { useOpenClawBotInstanceStatus } from "@/hooks/useOpenClawBotInstanceStatus";
import { useChannelTabs } from "@/hooks/useChannelTabs";
import { useChannelViews } from "@/hooks/useChannelViews";
import { TableView } from "./views/TableView";
import { BoardView } from "./views/BoardView";
import { CalendarView } from "./views/CalendarView";
import type {
  ChannelTab,
  ChannelView as ChannelViewType,
} from "@/types/properties";
import { useBotModelSwitch } from "@/hooks/useBotModelSwitch";
import type {
  AttachmentDto,
  ChannelWithUnread,
  Message,
  MessageAttachment,
  PublicChannelPreview,
} from "@/types/im";
import { isValidMessageId } from "@/lib/utils";
import { fileApi } from "@/services/api/file";

// ==================== ChannelFilesList ====================

function ChannelFilesList({
  channelId: _channelId,
  messages,
}: {
  channelId: string;
  messages: Message[];
}) {
  // Collect all attachments from messages
  const attachments = useMemo(() => {
    const result: Array<
      MessageAttachment & { senderName: string; sentAt: string }
    > = [];
    for (const msg of messages) {
      if (msg.attachments && msg.attachments.length > 0) {
        for (const att of msg.attachments) {
          result.push({
            ...att,
            senderName:
              msg.sender?.displayName || msg.sender?.username || "Unknown",
            sentAt: msg.createdAt,
          });
        }
      }
    }
    return result;
  }, [messages]);

  const handleDownload = useCallback(
    async (fileKey: string, fileName: string) => {
      try {
        const { url } = await fileApi.getDownloadUrl(fileKey);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        a.target = "_blank";
        a.click();
      } catch {
        // Fallback: open the file URL directly
        window.open(fileKey, "_blank");
      }
    },
    [],
  );

  if (attachments.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-center space-y-2">
          <File className="h-10 w-10 mx-auto opacity-40" />
          <p className="text-sm">No files shared in this channel yet.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto p-4">
      <div className="grid gap-2">
        {attachments.map((att) => {
          const isImage = att.mimeType?.startsWith("image/");
          const sizeStr = att.fileSize
            ? att.fileSize < 1024
              ? `${att.fileSize} B`
              : att.fileSize < 1048576
                ? `${(att.fileSize / 1024).toFixed(1)} KB`
                : `${(att.fileSize / 1048576).toFixed(1)} MB`
            : "";

          return (
            <div
              key={att.id}
              className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors"
            >
              {isImage && att.thumbnailUrl ? (
                <img
                  src={att.thumbnailUrl}
                  alt={att.fileName}
                  className="h-10 w-10 rounded object-cover shrink-0"
                />
              ) : (
                <div className="h-10 w-10 rounded bg-muted flex items-center justify-center shrink-0">
                  <File className="h-5 w-5 text-muted-foreground" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{att.fileName}</p>
                <p className="text-xs text-muted-foreground">
                  {sizeStr}
                  {sizeStr && " · "}
                  {att.senderName}
                  {" · "}
                  {new Date(att.sentAt).toLocaleDateString()}
                </p>
              </div>
              <button
                onClick={() => handleDownload(att.fileKey, att.fileName)}
                className="shrink-0 p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                title="Download"
              >
                <Download className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Extract mentioned bot user IDs directly from message HTML content
// Uses data-user-type attribute embedded in mention tags by the editor
function extractMentionedBotIds(content: string): string[] {
  const mentionRegex = /data-user-id="([^"]*)"[^>]*data-user-type="bot"/g;
  const botIds: string[] = [];
  let match;
  while ((match = mentionRegex.exec(content)) !== null) {
    botIds.push(match[1]);
  }
  return botIds;
}

interface ChannelViewProps {
  channelId: string;
  // Initial thread ID from URL - opens thread panel when set
  initialThreadId?: string;
  // Initial message ID from URL - for scrolling/highlighting (future use)
  initialMessageId?: string;
  // Draft text to pre-fill in the message input
  initialDraft?: string;
  // Automatically send the initial draft once after mounting
  autoSendInitialDraft?: boolean;
  // Called after the initial draft auto-send succeeds
  onInitialDraftAutoSent?: () => void;
  // Preview channel data for non-members (public channel preview mode)
  previewChannel?: PublicChannelPreview;
  // Hide the built-in ChannelHeader (e.g. when a parent component provides its own header)
  hideHeader?: boolean;
  // Show a read-only bar instead of the message input
  readOnly?: boolean;
}

/**
 * ChannelView - Renders channel for both members and non-members (preview mode)
 * When previewChannel is provided, shows read-only preview with join prompt
 */
export function ChannelView({
  channelId,
  initialThreadId,
  initialMessageId,
  initialDraft,
  autoSendInitialDraft,
  onInitialDraftAutoSent,
  previewChannel,
  hideHeader,
  readOnly,
}: ChannelViewProps) {
  const { t } = useTranslation("channel");
  const isPreviewMode = !!previewChannel;
  const { data: memberChannel, isLoading: channelLoading } = useChannel(
    isPreviewMode ? undefined : channelId,
  );
  const { data: members = [] } = useChannelMembers(
    isPreviewMode ? undefined : channelId,
  );
  const currentUser = useUser();

  // Use preview channel data or fetched channel data
  const channel = previewChannel || memberChannel;

  // Sync missed messages when opening channel (lazy loading)
  const { hasMoreUnsynced } = useSyncChannel(channelId);

  // Dual-layer thread state
  const primaryThread = useThreadStore((state) => state.primaryThread);
  const secondaryThread = useThreadStore((state) => state.secondaryThread);
  const openPrimaryThread = useThreadStore((state) => state.openPrimaryThread);
  const closePrimaryThread = useThreadStore(
    (state) => state.closePrimaryThread,
  );

  // Track whether the initial thread from URL has already been consumed
  const initialThreadConsumed = useRef(false);

  // Close thread panels when channel changes
  useEffect(() => {
    closePrimaryThread();
    initialThreadConsumed.current = false;
  }, [channelId, closePrimaryThread]);

  // Open thread panel from URL param (once per channel, not re-triggered on close)
  useEffect(() => {
    if (initialThreadId && !initialThreadConsumed.current) {
      initialThreadConsumed.current = true;
      openPrimaryThread(initialThreadId);
    }
  }, [initialThreadId, openPrimaryThread]);

  // Determine if we should anchor to the last read message (unread positioning)
  const unreadAnchor = useMemo(() => {
    if (isPreviewMode || !memberChannel) return undefined;
    const ch = memberChannel as ChannelWithUnread;
    // Anchor when there are unreads with a known position, within reasonable range
    if (ch.unreadCount > 0 && ch.lastReadMessageId && ch.unreadCount <= 200) {
      return ch.lastReadMessageId;
    }
    return undefined;
  }, [isPreviewMode, memberChannel]);

  const {
    data: messagesData,
    isLoading: messagesLoading,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
    hasPreviousPage,
    isFetchingPreviousPage,
    fetchPreviousPage,
  } = useChannelMessages(channelId, { anchorMessageId: unreadAnchor });
  const sendMessage = useSendMessage(channelId);
  const markAsRead = useMarkAsRead();
  const dmOtherUser = (memberChannel as ChannelWithUnread | undefined)
    ?.otherUser;

  // Determine if this is a bot DM channel
  const isBotDm = useMemo(() => {
    if (!memberChannel) return false;
    return memberChannel.type === "direct" && dmOtherUser?.userType === "bot";
  }, [dmOtherUser, memberChannel]);

  const botDmUserId = useMemo(() => {
    if (!isBotDm) return null;
    return dmOtherUser?.id ?? null;
  }, [dmOtherUser, isBotDm]);

  // Bot model switching for bot DM channels
  const botModelSwitch = useBotModelSwitch(isBotDm ? botDmUserId : null);

  // OpenClaw instance status for bot DM channels (to detect stopped instances)
  const {
    isInstanceStopped,
    isInstanceStarting,
    isOpenClawBot,
    canStart,
    startInstance,
    isStarting,
  } = useOpenClawBotInstanceStatus(isBotDm ? botDmUserId : null);

  // Bot startup countdown — only for OpenClaw bots (they need instance spin-up)
  const { phase, remainingSeconds, startChatting, showOverlay } =
    useBotStartupCountdown({
      channel: memberChannel,
      members,
      isOpenClawBot,
    });

  // Get current user's role in this channel
  const currentUserRole = useMemo(() => {
    if (!currentUser) return "member";
    const membership = members.find((m) => m.userId === currentUser.id);
    return membership?.role || "member";
  }, [members, currentUser]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [isSnapped, setIsSnapped] = useState(false);
  const [threadPanelWidth, setThreadPanelWidth] = useState(640);
  const threadPanelWidthRef = useRef(threadPanelWidth);
  threadPanelWidthRef.current = threadPanelWidth;

  const threadPanelCount =
    (primaryThread.isOpen ? 1 : 0) + (secondaryThread.isOpen ? 1 : 0);

  // Bot thinking indicator state (local)
  const [thinkingBotIds, setThinkingBotIds] = useState<string[]>([]);

  // Channel tabs state
  const { data: channelTabs = [] } = useChannelTabs(
    isPreviewMode ? undefined : channelId,
  );
  const { data: channelViews = [] } = useChannelViews(
    isPreviewMode ? undefined : channelId,
  );
  const [activeTabId, setActiveTabId] = useState<string>("");

  // Auto-select the first tab (messages) when tabs load, or reset on channel change
  useEffect(() => {
    if (channelTabs.length > 0) {
      // If current activeTabId is not in the list, select the first
      const exists = channelTabs.some((t: ChannelTab) => t.id === activeTabId);
      if (!exists) {
        const sorted = [...channelTabs].sort(
          (a: ChannelTab, b: ChannelTab) => a.order - b.order,
        );
        setActiveTabId(sorted[0].id);
      }
    }
  }, [channelTabs, activeTabId, channelId]);

  // Reset active tab when channel changes
  useEffect(() => {
    setActiveTabId("");
  }, [channelId]);

  // Determine active tab object
  const activeTab = channelTabs.find((t: ChannelTab) => t.id === activeTabId);
  const isFilesTab = activeTab?.type === "files";
  const isViewTab =
    activeTab?.type === "table_view" ||
    activeTab?.type === "board_view" ||
    activeTab?.type === "calendar_view";

  // Clear thinking state when channel changes
  useEffect(() => {
    setThinkingBotIds([]);
  }, [channelId]);

  // Dashboard auto-send should surface the bot thinking indicator immediately,
  // instead of waiting for the send path to resolve bot DM metadata.
  useEffect(() => {
    if (!autoSendInitialDraft || !initialDraft || !isBotDm || !botDmUserId) {
      return;
    }

    setThinkingBotIds((prev) =>
      prev.includes(botDmUserId) ? prev : [...prev, botDmUserId],
    );
  }, [autoSendInitialDraft, botDmUserId, initialDraft, isBotDm]);

  // Listen for bot replies or streaming start via WebSocket to dismiss thinking indicator
  useEffect(() => {
    if (thinkingBotIds.length === 0) return;

    const handleBotReply = (message: Message) => {
      if (message.channelId !== channelId) return;
      if (message.sender?.userType === "bot" && message.senderId) {
        setThinkingBotIds((prev) =>
          prev.filter((id) => id !== message.senderId),
        );
      }
    };

    const handleStreamingStart = (data: {
      channelId: string;
      senderId: string;
    }) => {
      if (data.channelId !== channelId) return;
      // Streaming started — remove bot from thinking indicators
      setThinkingBotIds((prev) => prev.filter((id) => id !== data.senderId));
    };

    wsService.onNewMessage(handleBotReply);
    wsService.onStreamingStart(handleStreamingStart);
    return () => {
      wsService.off("new_message", handleBotReply);
      wsService.off("streaming_start", handleStreamingStart);
    };
  }, [channelId, thinkingBotIds.length]);

  // Trigger thinking indicator after sending a message
  const startBotThinking = useCallback(
    (content: string) => {
      let botIds: string[] = [];

      if (isBotDm && botDmUserId) {
        // DM with bot: always trigger
        botIds = [botDmUserId];
      } else if (
        memberChannel?.type === "public" ||
        memberChannel?.type === "private"
      ) {
        // Public/private channel: trigger only if @mentioning a bot
        botIds = extractMentionedBotIds(content);
      }

      if (botIds.length > 0) {
        setThinkingBotIds(botIds);
      }
    },
    [isBotDm, botDmUserId, memberChannel?.type],
  );

  const messages = messagesData?.pages.flatMap((p) => p.messages) ?? [];
  // New messages are prepended to pages[0].messages, so messages[0] is the latest
  const latestMessageId = messages.length > 0 ? messages[0]?.id : null;

  // Auto-mark messages as read when viewing the channel or when new messages arrive
  // Skip for preview mode (non-members)
  // In anchored mode, only mark as read when there are no newer pages to load,
  // because messages[0] may not be the true latest message otherwise.
  useEffectOncePerKey(
    latestMessageId,
    Boolean(
      latestMessageId &&
      !isPreviewMode &&
      !hasPreviousPage &&
      !messagesLoading &&
      isValidMessageId(latestMessageId),
    ),
    (messageId) => {
      markAsRead.mutate({
        channelId,
        messageId,
      });
    },
  );

  // Monitor outer container width and calculate whether snap mode is needed
  // We observe the outer flex container (never hidden) rather than the main chat
  // div (which becomes hidden in snap mode and would stop firing ResizeObserver).
  // Also recalculate when threadPanelWidth changes (ResizeObserver won't fire
  // because the outer container size doesn't change when children resize).
  useEffect(() => {
    const el = containerRef.current;
    if (!el || threadPanelCount === 0) {
      setIsSnapped(false);
      return;
    }

    const recalc = () => {
      const containerWidth = el.getBoundingClientRect().width;
      const mainChatWidth =
        containerWidth - threadPanelCount * threadPanelWidthRef.current;
      setIsSnapped(mainChatWidth < 400);
    };

    // Recalculate immediately for threadPanelWidth changes
    recalc();

    const observer = new ResizeObserver(() => recalc());
    observer.observe(el);
    return () => observer.disconnect();
  }, [threadPanelCount, threadPanelWidth]);

  const handleSendMessage = async (
    content: string,
    attachments?: AttachmentDto[],
  ) => {
    // Allow sending if there's content or attachments
    if (!content.trim() && (!attachments || attachments.length === 0)) return;

    startBotThinking(content);
    try {
      await sendMessage.mutateAsync({ content, attachments });
    } catch {
      // Clear thinking indicators on send failure to avoid stale state
      setThinkingBotIds([]);
    }
  };

  if (channelLoading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{t("loadingChannel")}</p>
      </div>
    );
  }

  if (!channel) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">{t("channelNotFound")}</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="h-full flex">
      {/* Main channel content */}
      <div
        className={`flex-1 flex flex-col min-w-0 ${isSnapped ? "hidden" : ""}`}
      >
        {!hideHeader && (
          <ChannelHeader channel={channel} currentUserRole={currentUserRole} />
        )}

        {/* Channel tabs - only show for non-direct, non-preview channels */}
        {!isPreviewMode &&
          channel.type !== "direct" &&
          channelTabs.length > 0 && (
            <ChannelTabs
              channelId={channelId}
              activeTabId={activeTabId}
              onTabChange={setActiveTabId}
            />
          )}

        {/* Tab content */}
        {isViewTab ? (
          (() => {
            const view = activeTab?.viewId
              ? channelViews.find(
                  (v: ChannelViewType) => v.id === activeTab.viewId,
                )
              : undefined;
            if (!view) {
              return (
                <div className="flex-1 flex items-center justify-center text-muted-foreground">
                  <p className="text-sm">View not found</p>
                </div>
              );
            }
            switch (view.type) {
              case "table":
                return <TableView channelId={channelId} view={view} />;
              case "board":
                return <BoardView channelId={channelId} view={view} />;
              case "calendar":
                return <CalendarView channelId={channelId} view={view} />;
              default:
                return (
                  <div className="flex-1 flex items-center justify-center text-muted-foreground">
                    <p className="text-sm">Unknown view type: {view.type}</p>
                  </div>
                );
            }
          })()
        ) : isFilesTab ? (
          <ChannelFilesList channelId={channelId} messages={messages} />
        ) : showOverlay ? (
          <BotStartupOverlay
            phase={phase as "countdown" | "ready"}
            remainingSeconds={remainingSeconds}
            onStartChatting={startChatting}
          />
        ) : messagesLoading && messages.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {t("loadingMessages")}
            </p>
          </div>
        ) : (
          <ChannelContent
            channelId={channelId}
            channelType={channel?.type}
            messages={messages}
            isLoading={isFetchingNextPage}
            onLoadMore={() => {
              if (hasNextPage) fetchNextPage();
            }}
            hasMore={hasNextPage}
            onLoadNewer={() => {
              if (hasPreviousPage) fetchPreviousPage();
            }}
            hasNewer={hasPreviousPage}
            isLoadingNewer={isFetchingPreviousPage}
            highlightMessageId={initialMessageId}
            readOnly={isPreviewMode}
            thinkingBotIds={thinkingBotIds}
            members={members}
            lastReadMessageId={unreadAnchor}
            hasMoreUnsynced={hasMoreUnsynced}
            showReadOnlyBar={isPreviewMode || readOnly}
            onSend={isPreviewMode || readOnly ? undefined : handleSendMessage}
            isSendDisabled={showOverlay}
            initialDraft={initialDraft}
            autoSendInitialDraft={autoSendInitialDraft}
            onInitialDraftAutoSent={onInitialDraftAutoSent}
            isBotDm={isBotDm}
            botModelSwitch={isBotDm ? botModelSwitch : undefined}
          />
        )}

        {(isInstanceStopped || isInstanceStarting) && (
          <BotInstanceStoppedBanner
            onStart={startInstance}
            isStarting={isStarting}
            canStart={canStart}
            isInstanceStarting={isInstanceStarting}
          />
        )}

        {isPreviewMode && (
          <JoinChannelPrompt
            channelId={channelId}
            channelName={channel.name || ""}
          />
        )}
      </div>

      {/* Thread panel sidebars - up to 2 layers (hidden for direct messages) */}
      {channel?.type !== "direct" &&
        channel?.type !== "echo" &&
        primaryThread.isOpen &&
        primaryThread.rootMessageId && (
          <ThreadPanel
            level="primary"
            rootMessageId={primaryThread.rootMessageId}
            highlightMessageId={initialThreadId ? initialMessageId : undefined}
            isSnapped={isSnapped}
            width={threadPanelWidth}
            onWidthChange={setThreadPanelWidth}
          />
        )}
      {channel?.type !== "direct" &&
        channel?.type !== "echo" &&
        secondaryThread.isOpen &&
        secondaryThread.rootMessageId && (
          <ThreadPanel
            level="secondary"
            rootMessageId={secondaryThread.rootMessageId}
            isSnapped={isSnapped}
            width={threadPanelWidth}
            onWidthChange={setThreadPanelWidth}
          />
        )}
    </div>
  );
}

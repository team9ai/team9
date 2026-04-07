import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import type { AttachmentDto, Message, ChannelMember } from "@/types/im";

export interface ChannelContentProps {
  // MessageList props
  channelId: string;
  channelType?: string;
  messages: Message[];
  isLoading: boolean;
  onLoadMore: () => void;
  hasMore?: boolean;
  onLoadNewer?: () => void;
  hasNewer?: boolean;
  isLoadingNewer?: boolean;
  highlightMessageId?: string;
  readOnly?: boolean;
  thinkingBotIds?: string[];
  members?: ChannelMember[];
  lastReadMessageId?: string;

  // MessageInput props
  onSend?: (content: string, attachments?: AttachmentDto[]) => Promise<void>;
  isSendDisabled?: boolean;
  inputPlaceholder?: string;
  initialDraft?: string;

  // Optional UI controls
  hasMoreUnsynced?: boolean;
  /** Show read-only bar at bottom (independent of readOnly which controls MessageList) */
  showReadOnlyBar?: boolean;
}

export function ChannelContent({
  channelId,
  channelType,
  messages,
  isLoading,
  onLoadMore,
  hasMore,
  onLoadNewer,
  hasNewer,
  isLoadingNewer,
  highlightMessageId,
  readOnly = false,
  thinkingBotIds,
  members,
  lastReadMessageId,
  onSend,
  isSendDisabled,
  inputPlaceholder,
  initialDraft,
  hasMoreUnsynced,
  showReadOnlyBar,
}: ChannelContentProps) {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      {hasMoreUnsynced && (
        <div className="bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800 px-4 py-2 text-sm text-amber-700 dark:text-amber-300">
          You have older unread messages. Scroll up to load more.
        </div>
      )}

      <MessageList
        key={channelId}
        channelId={channelId}
        channelType={channelType}
        messages={messages}
        isLoading={isLoading}
        onLoadMore={onLoadMore}
        hasMore={hasMore}
        onLoadNewer={onLoadNewer}
        hasNewer={hasNewer}
        isLoadingNewer={isLoadingNewer}
        highlightMessageId={highlightMessageId}
        readOnly={readOnly}
        thinkingBotIds={thinkingBotIds}
        members={members}
        lastReadMessageId={lastReadMessageId}
      />

      {showReadOnlyBar ? (
        <div className="px-4 py-3 border-t border-border bg-muted/30 text-center">
          <span className="text-sm text-muted-foreground">Read-only</span>
        </div>
      ) : onSend ? (
        <MessageInput
          channelId={channelId}
          onSend={onSend}
          disabled={isSendDisabled}
          placeholder={inputPlaceholder}
          initialDraft={initialDraft}
        />
      ) : null}
    </div>
  );
}

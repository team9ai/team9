import { useState, useEffect, useCallback } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useChannelMessages, useSendMessage } from "@/hooks/useMessages";
import { useSyncChannel } from "@/hooks/useSyncChannel";
import { useChannelMembers } from "@/hooks/useChannels";
import { useChannelObserver } from "@/hooks/useChannelObserver";
import wsService from "@/services/websocket";
import { ChannelContent } from "./ChannelContent";
import type { IMUser, AttachmentDto } from "@/types/im";
import type {
  TrackingDeactivatedEvent,
  TrackingActivatedEvent,
} from "@/types/ws-events";

interface TrackingModalProps {
  isOpen: boolean;
  onClose: () => void;
  trackingChannelId: string | undefined;
  botUser?: IMUser;
  isActivated: boolean;
  /** @deprecated No longer used — streaming handled by useChannelMessages */
  initialActiveStream?: unknown;
}

export function TrackingModal({
  isOpen,
  onClose,
  trackingChannelId,
  botUser,
  isActivated: initialIsActivated,
}: TrackingModalProps) {
  const [isActivated, setIsActivated] = useState(initialIsActivated);

  // Sync with parent prop
  useEffect(() => {
    setIsActivated(initialIsActivated);
  }, [initialIsActivated]);

  // Observe the tracking channel's WS room (subscribe/unsubscribe)
  useChannelObserver(isOpen ? trackingChannelId : null);

  // Fetch messages + real-time WS listeners (new_message, streaming, reactions)
  const {
    data: messagesData,
    isLoading: messagesLoading,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
    hasPreviousPage,
    isFetchingPreviousPage,
    fetchPreviousPage,
  } = useChannelMessages(isOpen ? trackingChannelId : undefined);

  // Catch-up sync
  const { hasMoreUnsynced } = useSyncChannel(
    isOpen ? trackingChannelId : undefined,
  );

  // Channel members (for MessageList member display)
  const { data: members = [] } = useChannelMembers(
    isOpen ? trackingChannelId : undefined,
  );

  // Send messages
  const sendMessage = useSendMessage(trackingChannelId ?? "");

  const handleSend = useCallback(
    async (content: string, attachments?: AttachmentDto[]) => {
      if (!trackingChannelId) return;
      if (!content.trim() && (!attachments || attachments.length === 0)) return;
      await sendMessage.mutateAsync({ content, attachments });
    },
    [sendMessage, trackingChannelId],
  );

  // Tracking-specific WS events
  useEffect(() => {
    if (!isOpen || !trackingChannelId) return;

    const handleDeactivated = (event: TrackingDeactivatedEvent) => {
      if (event.channelId !== trackingChannelId) return;
      setIsActivated(false);
    };

    const handleActivated = (event: TrackingActivatedEvent) => {
      if (event.channelId !== trackingChannelId) return;
      setIsActivated(true);
    };

    wsService.onTrackingDeactivated(handleDeactivated);
    wsService.onTrackingActivated(handleActivated);

    return () => {
      wsService.offTrackingDeactivated(handleDeactivated);
      wsService.offTrackingActivated(handleActivated);
    };
  }, [isOpen, trackingChannelId]);

  if (!isOpen) return null;

  const messages = messagesData?.pages.flatMap((p) => p.messages) ?? [];
  const displayName = botUser?.displayName ?? botUser?.username ?? "Bot";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-2xl h-[80vh] bg-background border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-xs text-primary-foreground font-bold">
              {displayName[0]}
            </div>
            <div>
              <div className="text-sm font-semibold">{displayName}</div>
              <div className="text-xs text-muted-foreground">
                Tracking Channel
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {isActivated && (
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-xs text-emerald-500">Running</span>
              </div>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="h-7 w-7"
            >
              <X size={16} />
            </Button>
          </div>
        </div>

        {/* Message area — uses shared ChannelContent */}
        <div className="flex-1 flex flex-col min-h-0">
          {messagesLoading && messages.length === 0 ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-muted-foreground">Loading messages...</p>
            </div>
          ) : (
            <ChannelContent
              channelId={trackingChannelId ?? ""}
              channelType="tracking"
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
              readOnly={!isActivated}
              showReadOnlyBar={!isActivated}
              members={members}
              hasMoreUnsynced={hasMoreUnsynced}
              onSend={isActivated ? handleSend : undefined}
              isSendDisabled={sendMessage.isPending}
              inputPlaceholder="Send guidance to agent..."
            />
          )}
        </div>
      </div>
    </div>
  );
}

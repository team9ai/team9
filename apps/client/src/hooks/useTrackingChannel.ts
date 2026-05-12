import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { normalizeTrackingSnapshot } from "@/lib/agent-event-metadata";
import {
  clearPersistedStreamMetadata,
  loadPersistedStreamMetadata,
  mergeStreamingMetadata,
  persistStreamMetadata,
} from "@/lib/streaming-metadata";
import imApi from "@/services/api/im";
import wsService from "@/services/websocket";
import { WS_EVENTS } from "@/types/ws-events";
import { useChannelObserver } from "./useChannelObserver";
import type { Message, ChannelSnapshot } from "@/types/im";
import type {
  StreamingStartEvent,
  StreamingContentEvent,
  StreamingMetadataEvent,
  StreamingEndEvent,
  TrackingDeactivatedEvent,
} from "@/types/ws-events";

type TrackingLatestMessage = Pick<
  Message,
  "id" | "content" | "metadata" | "createdAt"
> &
  Partial<Pick<Message, "type" | "isTruncated" | "fullContentLength">>;

interface TrackingChannelState {
  isActivated: boolean;
  latestMessages: TrackingLatestMessage[];
  totalMessageCount: number;
  isLoading: boolean;
  /** Currently streaming message (not yet persisted) */
  activeStream: {
    streamId: string;
    content: string;
    metadata?: Record<string, unknown>;
  } | null;
}

function appendLatestTrackingMessage(
  messages: TrackingChannelState["latestMessages"],
  message: TrackingLatestMessage,
): TrackingChannelState["latestMessages"] {
  return [
    ...messages.filter((existing) => existing.id !== message.id),
    message,
  ].slice(-10);
}

/**
 * Hook to manage tracking channel data for inline card display.
 * Handles initial loading, observe subscription, and streaming updates.
 */
export function useTrackingChannel(trackingChannelId: string | undefined) {
  const queryClient = useQueryClient();
  const [activeStream, setActiveStream] =
    useState<TrackingChannelState["activeStream"]>(null);
  const [extraMessages, setExtraMessages] = useState<
    TrackingChannelState["latestMessages"]
  >([]);
  const [isDeactivated, setIsDeactivated] = useState(false);
  const [snapshot, setSnapshot] = useState<ChannelSnapshot | null>(null);

  // Fetch channel info to determine state
  const { data: channelInfo, isLoading: isLoadingChannel } = useQuery({
    queryKey: ["channels", trackingChannelId],
    queryFn: () => imApi.channels.getChannel(trackingChannelId!),
    enabled: !!trackingChannelId,
    staleTime: Infinity,
    retry: false,
  });

  const isActivated = channelInfo ? channelInfo.isActivated : true;

  // For deactivated channels, use snapshot from channel info
  useEffect(() => {
    if (channelInfo && !channelInfo.isActivated && channelInfo.snapshot) {
      setSnapshot(normalizeTrackingSnapshot(channelInfo.snapshot));
      setIsDeactivated(true);
    }
  }, [channelInfo]);

  // For active channels, fetch latest messages
  // messagesApi.getMessages returns Message[] directly
  const { data: fetchedMessages = [], isLoading: isLoadingMessages } = useQuery(
    {
      queryKey: ["trackingMessages", trackingChannelId],
      queryFn: () =>
        imApi.messages.getMessages(trackingChannelId!, { limit: 3 }),
      enabled: !!trackingChannelId && isActivated && !isDeactivated,
      staleTime: 30000,
    },
  );

  // Observe active tracking channels
  useChannelObserver(
    trackingChannelId && isActivated && !isDeactivated
      ? trackingChannelId
      : null,
  );

  // Listen for new messages in observed channel
  useEffect(() => {
    if (!trackingChannelId || isDeactivated) return;

    const handleNewMessage = (msg: Message) => {
      if (msg.channelId !== trackingChannelId) return;
      setExtraMessages((prev) => appendLatestTrackingMessage(prev, msg));
    };

    const handleStreamStart = (event: StreamingStartEvent) => {
      if (event.channelId !== trackingChannelId) return;
      const metadata = mergeStreamingMetadata(
        loadPersistedStreamMetadata(event.streamId),
        event.metadata,
      );
      setActiveStream({
        streamId: event.streamId,
        content: "",
        metadata,
      });
      persistStreamMetadata(event.streamId, metadata);
    };

    const handleStreamContent = (event: StreamingContentEvent) => {
      setActiveStream((prev) => {
        if (!prev || prev.streamId !== event.streamId) return prev;
        return { ...prev, content: event.content };
      });
    };

    const handleStreamMetadata = (event: StreamingMetadataEvent) => {
      if (event.channelId !== trackingChannelId) return;
      setActiveStream((prev) => {
        const base =
          prev && prev.streamId === event.streamId
            ? prev.metadata
            : loadPersistedStreamMetadata(event.streamId);
        const metadata = mergeStreamingMetadata(base, event.metadata);
        persistStreamMetadata(event.streamId, metadata);
        if (!prev || prev.streamId !== event.streamId) {
          return {
            streamId: event.streamId,
            content: "",
            metadata,
          };
        }
        return {
          ...prev,
          metadata,
        };
      });
    };

    const handleStreamEnd = (event: StreamingEndEvent) => {
      if (event.channelId !== trackingChannelId) return;
      clearPersistedStreamMetadata(event.streamId);
      setActiveStream((prev) => {
        if (!prev || prev.streamId !== event.streamId) return prev;
        return null;
      });
      const { message } = event;
      if (message) {
        setExtraMessages((prev) => appendLatestTrackingMessage(prev, message));
      } else {
        queryClient.invalidateQueries({
          queryKey: ["trackingMessages", trackingChannelId],
          refetchType: "all",
        });
      }
    };

    const handleDeactivated = (event: TrackingDeactivatedEvent) => {
      if (event.channelId !== trackingChannelId) return;
      setIsDeactivated(true);
      setSnapshot(normalizeTrackingSnapshot(event.snapshot));
      setActiveStream((prev) => {
        if (prev) clearPersistedStreamMetadata(prev.streamId);
        return null;
      });
    };

    wsService.onNewMessage(handleNewMessage);
    wsService.on(WS_EVENTS.STREAMING.START, handleStreamStart);
    wsService.on(WS_EVENTS.STREAMING.CONTENT, handleStreamContent);
    wsService.on(WS_EVENTS.STREAMING.METADATA, handleStreamMetadata);
    wsService.on(WS_EVENTS.STREAMING.END, handleStreamEnd);
    wsService.onTrackingDeactivated(handleDeactivated);

    return () => {
      wsService.off(WS_EVENTS.MESSAGE.NEW, handleNewMessage);
      wsService.off(WS_EVENTS.STREAMING.START, handleStreamStart);
      wsService.off(WS_EVENTS.STREAMING.CONTENT, handleStreamContent);
      wsService.off(WS_EVENTS.STREAMING.METADATA, handleStreamMetadata);
      wsService.off(WS_EVENTS.STREAMING.END, handleStreamEnd);
      wsService.offTrackingDeactivated(handleDeactivated);
    };
  }, [trackingChannelId, isDeactivated, queryClient]);

  // Compute latest 3 messages
  const allMessages: TrackingChannelState["latestMessages"] = [
    ...fetchedMessages,
    ...extraMessages,
  ];
  const latest3 = allMessages.slice(-3);

  // Use snapshot for deactivated channels
  if (isDeactivated && snapshot) {
    return {
      isActivated: false,
      latestMessages: snapshot.latestMessages,
      totalMessageCount: snapshot.totalMessageCount,
      isLoading: isLoadingChannel,
      activeStream: null,
    };
  }

  return {
    isActivated: true,
    latestMessages: latest3,
    totalMessageCount: allMessages.length,
    isLoading: isLoadingChannel || isLoadingMessages,
    activeStream,
  };
}

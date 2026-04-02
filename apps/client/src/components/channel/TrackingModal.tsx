import { useState, useEffect, useRef } from "react";
import { X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { getAgentEventMetadata } from "@/lib/agent-event-metadata";
import imApi from "@/services/api/im";
import wsService from "@/services/websocket";
import { WS_EVENTS } from "@/types/ws-events";
import { useChannelObserver } from "@/hooks/useChannelObserver";
import { TrackingEventItem } from "./TrackingEventItem";
import type { Message, IMUser } from "@/types/im";
import type {
  StreamingStartEvent,
  StreamingContentEvent,
  StreamingEndEvent,
} from "@/types/ws-events";

interface TrackingModalProps {
  isOpen: boolean;
  onClose: () => void;
  trackingChannelId: string | undefined;
  botUser?: IMUser;
  isActivated: boolean;
  initialActiveStream?: {
    streamId: string;
    content: string;
    metadata?: Record<string, unknown>;
  } | null;
}

export function TrackingModal({
  isOpen,
  onClose,
  trackingChannelId,
  botUser,
  isActivated,
  initialActiveStream,
}: TrackingModalProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [activeStream, setActiveStream] = useState<{
    streamId: string;
    content: string;
    metadata?: Record<string, unknown>;
  } | null>(null);

  // Sync active stream from parent when modal opens
  useEffect(() => {
    if (isOpen && initialActiveStream && !activeStream) {
      setActiveStream(initialActiveStream);
    }
  }, [isOpen, initialActiveStream, activeStream]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Observe channel when modal is open
  useChannelObserver(isOpen ? trackingChannelId : null);

  // Fetch all messages when modal opens
  const { data: fetchedMessages } = useQuery({
    queryKey: ["trackingModalMessages", trackingChannelId],
    queryFn: () =>
      imApi.messages.getMessages(trackingChannelId!, { limit: 100 }),
    enabled: isOpen && !!trackingChannelId,
  });

  useEffect(() => {
    if (fetchedMessages) {
      setMessages(fetchedMessages);
    }
  }, [fetchedMessages]);

  // Listen for real-time updates
  useEffect(() => {
    if (!isOpen || !trackingChannelId) return;

    const handleNewMessage = (msg: Message) => {
      if (msg.channelId !== trackingChannelId) return;
      setMessages((prev) => [...prev, msg]);
    };

    const handleStreamStart = (event: StreamingStartEvent) => {
      if (event.channelId !== trackingChannelId) return;
      setActiveStream({
        streamId: event.streamId,
        content: "",
        metadata: event.metadata,
      });
    };

    const handleStreamContent = (event: StreamingContentEvent) => {
      setActiveStream((prev) => {
        if (!prev || prev.streamId !== event.streamId) return prev;
        return { ...prev, content: event.content };
      });
    };

    const handleStreamEnd = (event: StreamingEndEvent) => {
      setActiveStream((prev) => {
        if (!prev || prev.streamId !== event.streamId) return prev;
        return null;
      });
    };

    wsService.on(WS_EVENTS.MESSAGE.NEW, handleNewMessage);
    wsService.on(WS_EVENTS.STREAMING.START, handleStreamStart);
    wsService.on(WS_EVENTS.STREAMING.CONTENT, handleStreamContent);
    wsService.on(WS_EVENTS.STREAMING.END, handleStreamEnd);

    return () => {
      wsService.off(WS_EVENTS.MESSAGE.NEW, handleNewMessage);
      wsService.off(WS_EVENTS.STREAMING.START, handleStreamStart);
      wsService.off(WS_EVENTS.STREAMING.CONTENT, handleStreamContent);
      wsService.off(WS_EVENTS.STREAMING.END, handleStreamEnd);
    };
  }, [isOpen, trackingChannelId]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages.length, activeStream?.content]);

  const handleSend = async () => {
    if (!inputValue.trim() || !trackingChannelId) return;
    try {
      await imApi.messages.sendMessage(trackingChannelId, {
        content: inputValue.trim(),
      });
      setInputValue("");
    } catch {
      // Handle error silently for now
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-2xl max-h-[80vh] bg-background border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-xs text-primary-foreground font-bold">
              {botUser?.displayName?.[0] ?? botUser?.username?.[0] ?? "B"}
            </div>
            <div>
              <div className="text-sm font-semibold">
                {botUser?.displayName ?? botUser?.username ?? "Bot"}
              </div>
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

        {/* Message list */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-5 py-4 space-y-3"
        >
          {messages.map((msg) => {
            const meta = getAgentEventMetadata(msg.metadata, {
              agentEventType: "writing",
              status: "completed",
            });

            // Turn separator
            if (meta.agentEventType === "turn_separator") {
              return (
                <div key={msg.id} className="flex items-center gap-2 py-1">
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-[10px] text-muted-foreground">
                    {msg.content}
                  </span>
                  <div className="flex-1 h-px bg-border" />
                </div>
              );
            }

            return (
              <div
                key={msg.id}
                className="flex items-start gap-2.5 p-2 rounded-lg bg-muted/30"
              >
                <TrackingEventItem
                  metadata={meta}
                  content={msg.content ?? ""}
                  compact={false}
                />
              </div>
            );
          })}

          {/* Active streaming message */}
          {activeStream && (
            <div className="flex items-start gap-2.5 p-2 rounded-lg bg-muted/30">
              <TrackingEventItem
                metadata={getAgentEventMetadata(activeStream.metadata, {
                  agentEventType: "writing",
                  status: "running",
                })}
                content={activeStream.content}
                isStreaming
                compact={false}
              />
            </div>
          )}
        </div>

        {/* Input area */}
        {isActivated && (
          <div className="flex items-center gap-2.5 px-5 py-3 border-t border-border">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              placeholder="Send guidance to agent..."
              className="flex-1 bg-muted border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <Button
              size="sm"
              onClick={handleSend}
              disabled={!inputValue.trim()}
            >
              ↑
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

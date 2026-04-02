import { useState, useEffect } from "react";
import { UserAvatar } from "@/components/ui/user-avatar";
import { getAgentEventMetadata } from "@/lib/agent-event-metadata";
import { parseLikelyPastDate } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
import { useTrackingChannel } from "@/hooks/useTrackingChannel";
import { TrackingEventItem } from "./TrackingEventItem";
import { TrackingModal } from "./TrackingModal";
import type { Message, AgentEventMetadata } from "@/types/im";

interface TrackingCardProps {
  message: Message;
}

function formatElapsed(startTime: string | number): string {
  const startedAt = parseLikelyPastDate(startTime).getTime();
  if (Number.isNaN(startedAt)) return "0m 00s";

  const elapsed = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

export function TrackingCard({ message }: TrackingCardProps) {
  const metadata = (message.metadata ?? {}) as Record<string, unknown>;
  const trackingChannelId = metadata?.trackingChannelId as string | undefined;
  const {
    isActivated,
    latestMessages,
    totalMessageCount,
    isLoading,
    activeStream,
  } = useTrackingChannel(trackingChannelId);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [elapsed, setElapsed] = useState("");
  const elapsedStartTime =
    typeof metadata.startedAt === "string" ||
    typeof metadata.startedAt === "number"
      ? metadata.startedAt
      : message.createdAt;

  // Live-updating elapsed timer
  useEffect(() => {
    if (!elapsedStartTime) return;
    if (!isActivated) {
      setElapsed(formatElapsed(elapsedStartTime));
      return;
    }
    const update = () => setElapsed(formatElapsed(elapsedStartTime));
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [elapsedStartTime, isActivated]);

  const moreCount = totalMessageCount - 3;
  const showFrost = moreCount > 0;

  // Build display items: latest messages + active stream
  const displayItems: Array<{
    id: string;
    content: string;
    metadata: AgentEventMetadata;
    isStreaming: boolean;
  }> = latestMessages.map((msg) => ({
    id: msg.id,
    content: msg.content ?? "",
    metadata: getAgentEventMetadata(msg.metadata, {
      agentEventType: "writing",
      status: "completed",
    }),
    isStreaming: false,
  }));

  if (activeStream) {
    displayItems.push({
      id: `stream-${activeStream.streamId}`,
      content: activeStream.content,
      metadata: getAgentEventMetadata(activeStream.metadata, {
        agentEventType: "writing",
        status: "running",
      }),
      isStreaming: true,
    });
  }

  // Only show last 3
  const visibleItems = displayItems.slice(-3);

  return (
    <>
      <div
        onClick={() => setIsModalOpen(true)}
        className={cn(
          "rounded-lg p-4 max-w-md cursor-pointer border border-transparent",
          "bg-muted/50 transition-all duration-200",
          "hover:bg-muted hover:border-border hover:shadow-md",
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <UserAvatar
              userId={message.sender?.id ?? message.senderId ?? undefined}
              name={message.sender?.displayName}
              username={message.sender?.username}
              avatarUrl={message.sender?.avatarUrl}
              isBot={message.sender?.userType === "bot"}
              className="w-8 h-8"
              fallbackClassName="text-xs"
            />
            <span className="text-sm font-semibold">
              {message.sender?.displayName ?? message.sender?.username ?? "Bot"}
            </span>
          </div>
          {elapsed && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-background/80 px-2 py-0.5 rounded-full">
              {isActivated ? (
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              ) : (
                <span className="text-emerald-500">✓</span>
              )}
              <span>{elapsed}</span>
            </div>
          )}
        </div>

        {/* Bot summary text */}
        {message.content && (
          <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
            {message.content}
          </p>
        )}

        {/* Timeline */}
        {!isLoading && visibleItems.length > 0 && (
          <div className="border-l-2 border-border ml-1 pl-3 relative flex flex-col gap-2.5">
            {/* Frosted glass overlay on first item */}
            {showFrost && (
              <div className="absolute -top-1 -left-0.5 right-0 h-8 z-10 backdrop-blur-[3px] bg-muted/60 rounded-t flex items-center justify-center">
                <span className="text-[11px] text-muted-foreground">
                  View {moreCount} more details ›
                </span>
              </div>
            )}
            {visibleItems.map((item) => (
              <TrackingEventItem
                key={item.id}
                metadata={item.metadata}
                content={item.content}
                isStreaming={item.isStreaming}
                compact
              />
            ))}
          </div>
        )}

        {isLoading && (
          <div className="text-xs text-muted-foreground py-2">Loading...</div>
        )}
      </div>

      {/* Modal */}
      <TrackingModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        trackingChannelId={trackingChannelId}
        botUser={message.sender}
        isActivated={isActivated}
        initialActiveStream={activeStream}
      />
    </>
  );
}

import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { UserAvatar } from "@/components/ui/user-avatar";
import {
  getAgentEventMetadata,
  getOptionalAgentEventMetadata,
} from "@/lib/agent-event-metadata";
import { parseLikelyPastDate } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
import { useTrackingChannel } from "@/hooks/useTrackingChannel";
import { ToolCallBlock } from "./ToolCallBlock";
import { TrackingEventItem } from "./TrackingEventItem";
import { TrackingModal } from "./TrackingModal";
import type { Message, AgentEventMetadata } from "@/types/im";

interface TrackingCardProps {
  message: Message;
}

export interface TrackingDisplayItem {
  id: string;
  content: string;
  metadata: AgentEventMetadata;
  isStreaming: boolean;
  createdAt?: string;
}

export type TrackingRenderItem =
  | { type: "event"; item: TrackingDisplayItem }
  | {
      type: "toolCall";
      callItem: TrackingDisplayItem;
      resultItem: TrackingDisplayItem;
    };

/**
 * Merge consecutive tool_call + tool_result pairs (matching toolCallId) into a
 * single "toolCall" render item so the card renders them as one ToolCallBlock
 * (consistent with MessageList). All other items pass through as "event"
 * render items rendered by TrackingEventItem.
 *
 * Exported for direct unit testing.
 */
export function buildRenderItems(
  items: TrackingDisplayItem[],
): TrackingRenderItem[] {
  const result: TrackingRenderItem[] = [];
  let i = 0;
  while (i < items.length) {
    const item = items[i];
    const next = items[i + 1];

    if (
      item.metadata.agentEventType === "tool_call" &&
      item.metadata.toolCallId &&
      next?.metadata.agentEventType === "tool_result" &&
      next.metadata.toolCallId === item.metadata.toolCallId
    ) {
      result.push({ type: "toolCall", callItem: item, resultItem: next });
      i += 2;
    } else {
      result.push({ type: "event", item });
      i += 1;
    }
  }
  return result;
}

function formatElapsed(startTime: string | number): string {
  const startedAt = parseLikelyPastDate(startTime).getTime();
  if (Number.isNaN(startedAt)) return "0m 00s";

  const elapsed = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function getTrackingItemTimeMs(item: TrackingDisplayItem): number {
  if (item.metadata.startedAt) {
    const startedAt = new Date(item.metadata.startedAt).getTime();
    if (!Number.isNaN(startedAt)) return startedAt;
  }

  if (item.createdAt) {
    const createdAt = new Date(item.createdAt).getTime();
    if (!Number.isNaN(createdAt)) return createdAt;
  }

  return Number.POSITIVE_INFINITY;
}

function sortTrackingDisplayItems(
  items: TrackingDisplayItem[],
): TrackingDisplayItem[] {
  return items
    .map((item, index) => ({ item, index, time: getTrackingItemTimeMs(item) }))
    .sort((a, b) => a.time - b.time || a.index - b.index)
    .map(({ item }) => item);
}

export function TrackingCard({ message }: TrackingCardProps) {
  const { t } = useTranslation("channel");
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
  const displayItems: TrackingDisplayItem[] = latestMessages.flatMap((msg) => {
    const metadata = getOptionalAgentEventMetadata(msg.metadata);
    return metadata && metadata.agentEventType !== "writing"
      ? [
          {
            id: msg.id,
            content: msg.content ?? "",
            metadata,
            isStreaming: false,
            createdAt: msg.createdAt,
          },
        ]
      : [];
  });

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

  // Merge consecutive tool_call + tool_result pairs into a single ToolCallBlock
  // render item (matching MessageList behaviour). Then only show the latest 3
  // render items — a merged toolCall counts as 1 slot rather than 2.
  const renderItems = buildRenderItems(sortTrackingDisplayItems(displayItems));
  const visibleRenderItems = renderItems.slice(-3);

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
        {!isLoading && visibleRenderItems.length > 0 && (
          <div className="border-l-2 border-border ml-1 pl-3 relative flex flex-col gap-2.5">
            {/* Frosted glass overlay on first item */}
            {showFrost && (
              <div className="absolute -top-1 -left-0.5 right-0 h-8 z-10 backdrop-blur-[3px] bg-muted/60 rounded-t flex items-center justify-center">
                <span className="text-[11px] text-muted-foreground">
                  {t("tracking.card.moreDetails", { count: moreCount })}
                </span>
              </div>
            )}
            {visibleRenderItems.map((ri) => {
              if (ri.type === "toolCall") {
                return (
                  <ToolCallBlock
                    key={ri.callItem.id}
                    callMetadata={ri.callItem.metadata}
                    resultMetadata={ri.resultItem.metadata}
                    resultContent={ri.resultItem.content}
                  />
                );
              }
              if (ri.item.metadata.agentEventType === "tool_call") {
                return (
                  <ToolCallBlock
                    key={ri.item.id}
                    callMetadata={ri.item.metadata}
                    resultContent=""
                  />
                );
              }
              return (
                <TrackingEventItem
                  key={ri.item.id}
                  metadata={ri.item.metadata}
                  content={ri.item.content}
                  isStreaming={ri.item.isStreaming}
                  compact
                />
              );
            })}
          </div>
        )}

        {isLoading && (
          <div className="text-xs text-muted-foreground py-2">
            {t("tracking.card.loading")}
          </div>
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

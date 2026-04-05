import type { AgentEventMetadata, Message } from "@/types/im";

export interface A2UIResponseItemProps {
  message: Message;
  metadata: AgentEventMetadata;
}

/**
 * Compact single-line display for an A2UI response message.
 * Styled like TrackingEventItem — left border, compact, muted colors.
 */
export function A2UIResponseItem({
  message,
  metadata: _metadata,
}: A2UIResponseItemProps) {
  return (
    <div className="flex items-center min-h-6">
      {/* Status dot */}
      <div className="w-2 h-2 rounded-full shrink-0 mr-[26px] bg-emerald-500" />
      {/* Label */}
      <span className="text-xs font-semibold shrink-0 w-[72px] text-emerald-500">
        Selected
      </span>
      {/* Content summary */}
      <span className="text-xs truncate flex-1 min-w-0 ml-2 text-muted-foreground">
        {message.content}
      </span>
    </div>
  );
}

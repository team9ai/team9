import type { AgentEventMetadata, Message } from "@/types/im";

export interface A2UIResponseItemProps {
  message: Message;
  metadata: AgentEventMetadata;
}

/**
 * Compact single-line display for an A2UI response message.
 * Styled like TrackingEventItem — left border, compact, muted colors.
 */
export function A2UIResponseItem({ message, metadata }: A2UIResponseItemProps) {
  // Use message content if available, fall back to metadata selections
  let summary = message.content;
  if (!summary && metadata.selections) {
    summary = Object.entries(metadata.selections)
      .map(([title, sel]) => {
        const raw = sel as { selected: string[]; otherText?: string | null };
        const vals = (raw.selected ?? []).filter((v) => v !== "__other__");
        if (raw.otherText) vals.push(`Other — "${raw.otherText}"`);
        return `${title}: ${vals.join(", ")}`;
      })
      .join("; ");
  }

  return (
    <div className="flex items-center min-h-6">
      {/* Checkmark */}
      <span className="shrink-0 mr-2 text-emerald-500 text-xs">✓</span>
      {/* Label */}
      <span className="text-xs font-semibold shrink-0 text-emerald-500">
        Selected:
      </span>
      {/* Content summary */}
      <span className="text-xs truncate flex-1 min-w-0 ml-1 text-muted-foreground">
        {summary || "—"}
      </span>
    </div>
  );
}

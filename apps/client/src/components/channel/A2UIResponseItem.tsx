import type { AgentEventMetadata, Message } from "@/types/im";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useCurrentUser } from "@/hooks/useAuth";
import { formatAbsoluteTooltip } from "@/lib/date-format";
import { formatMessageTime, parseApiDate } from "@/lib/date-utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export interface A2UIResponseItemProps {
  message: Message;
  metadata: AgentEventMetadata;
}

function normalizeSelectionText(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return "";

  const parts = trimmed
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 1) {
    const delimiterIndex = parts[0].lastIndexOf(":");
    return delimiterIndex >= 0
      ? parts[0].slice(delimiterIndex + 1).trim()
      : parts[0];
  }

  return parts
    .map((part) => {
      const delimiterIndex = part.lastIndexOf(":");
      if (delimiterIndex < 0) return part;
      const title = part.slice(0, delimiterIndex).trim();
      const value = part.slice(delimiterIndex + 1).trim();
      return title ? `${title}：${value}` : value;
    })
    .join("；");
}

function buildFallbackSelectionText(
  selections: AgentEventMetadata["selections"],
): string {
  if (!selections) return "";

  const parts = Object.entries(selections).map(([title, sel]) => {
    const vals = (sel.selected ?? []).filter((v) => v !== "__other__");
    if (sel.otherText) vals.push(`Other — "${sel.otherText}"`);
    const text = vals.join(", ");
    return title ? `${title}：${text}` : text;
  });

  if (parts.length === 1) {
    const delimiterIndex = parts[0].lastIndexOf("：");
    return delimiterIndex >= 0
      ? parts[0].slice(delimiterIndex + 1).trim()
      : parts[0];
  }

  return parts.join("；");
}

/**
 * Compact single-line display for an A2UI response message.
 * Styled like TrackingEventItem — left border, compact, muted colors.
 */
export function A2UIResponseItem({ message, metadata }: A2UIResponseItemProps) {
  const currentUser = useCurrentUser();
  const displayName =
    metadata.responderName ??
    message.sender?.displayName ??
    message.sender?.username ??
    "User";
  const isCurrentUser =
    !!message.senderId && message.senderId === currentUser.data?.id;
  const actorLabel = `${displayName}${isCurrentUser ? "(你)" : ""}`;
  const createdAt = parseApiDate(message.createdAt);
  const timeLabel = formatMessageTime(createdAt);
  const summary =
    normalizeSelectionText(message.content) ||
    buildFallbackSelectionText(metadata.selections) ||
    "—";

  return (
    <div className="group/a2ui-response flex min-h-7 items-center gap-2">
      <UserAvatar
        userId={metadata.responderId ?? message.senderId ?? undefined}
        name={displayName}
        username={message.sender?.username}
        avatarUrl={metadata.responderAvatarUrl ?? message.sender?.avatarUrl}
        className="h-5 w-5"
        fallbackClassName="text-[10px] font-semibold"
      />
      <span className="shrink-0 text-emerald-500 text-xs font-semibold">✓</span>
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">{actorLabel}</span>
        <span>在{timeLabel}已选择了</span>
        <span className="text-foreground">{summary}</span>
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="shrink-0 text-[11px] text-muted-foreground opacity-0 transition-opacity group-hover/a2ui-response:opacity-100">
            {timeLabel}
          </span>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          className="bg-foreground text-background border-foreground text-xs font-medium"
        >
          {formatAbsoluteTooltip(createdAt)}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

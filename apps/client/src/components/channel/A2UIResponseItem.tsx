import type { AgentEventMetadata, Message } from "@/types/im";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useCurrentUser } from "@/hooks/useAuth";
import { useTranslation } from "react-i18next";
import { formatAbsoluteTooltip } from "@/lib/date-format";
import { formatMessageTime, parseApiDate } from "@/lib/date-utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { UserHoverCard } from "./UserHoverCard";

export interface A2UIResponseItemProps {
  message: Message;
  metadata: AgentEventMetadata;
}

function parseContentSelection(
  content: string,
  fallbackOptionLabel: string,
): { title: string; selection: string } | null {
  const trimmed = content.trim();
  if (!trimmed) return null;

  const parts = trimmed
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 1) {
    const delimiterIndex = parts[0].lastIndexOf(":");
    if (delimiterIndex >= 0) {
      return {
        title: parts[0].slice(0, delimiterIndex).trim(),
        selection: parts[0].slice(delimiterIndex + 1).trim(),
      };
    }
    return { title: fallbackOptionLabel, selection: parts[0] };
  }

  const parsedParts = parts.map((part) => {
    const delimiterIndex = part.lastIndexOf(":");
    if (delimiterIndex < 0) return { title: "", selection: part };
    return {
      title: part.slice(0, delimiterIndex).trim(),
      selection: part.slice(delimiterIndex + 1).trim(),
    };
  });

  return {
    title:
      parsedParts
        .map((part) => part.title)
        .filter(Boolean)
        .join(" / ") || fallbackOptionLabel,
    selection: parsedParts
      .map((part) => part.selection)
      .filter(Boolean)
      .join("；"),
  };
}

function buildFallbackSelectionDisplay(
  selections: AgentEventMetadata["selections"],
  otherLabel: string,
): { title: string; selection: string } | null {
  if (!selections) return null;

  const parts = Object.entries(selections).map(([title, sel]) => {
    const vals = (sel.selected ?? []).filter((v) => v !== "__other__");
    if (sel.otherText) vals.push(`${otherLabel} — "${sel.otherText}"`);
    return { title, selection: vals.join(", ") };
  });

  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];

  return {
    title: parts.map((part) => part.title).join(" / "),
    selection: parts
      .map((part) => part.selection)
      .filter(Boolean)
      .join("；"),
  };
}

/**
 * Compact single-line display for an A2UI response message.
 */
export function A2UIResponseItem({ message, metadata }: A2UIResponseItemProps) {
  const { t } = useTranslation("message");
  const currentUser = useCurrentUser();
  const displayName =
    metadata.responderName ??
    message.sender?.displayName ??
    message.sender?.username ??
    t("a2ui.userFallback");
  const isCurrentUser =
    !!message.senderId && message.senderId === currentUser.data?.id;
  const actorLabel = `${displayName}${
    isCurrentUser ? t("a2ui.currentUserSuffix") : ""
  }`;
  const actorUserId = metadata.responderId ?? message.senderId ?? undefined;
  const createdAt = parseApiDate(message.createdAt);
  const timeLabel = formatMessageTime(createdAt);
  const selectionDisplay = parseContentSelection(
    message.content,
    t("a2ui.optionFallback"),
  ) ??
    buildFallbackSelectionDisplay(metadata.selections, t("a2ui.other")) ?? {
      title: t("a2ui.optionFallback"),
      selection: "—",
    };

  return (
    <div className="group/a2ui-response flex min-h-8 items-center gap-3">
      <UserHoverCard userId={actorUserId} displayName={displayName}>
        <span className="inline-flex shrink-0 cursor-pointer items-center">
          <UserAvatar
            userId={actorUserId}
            name={displayName}
            username={message.sender?.username}
            avatarUrl={metadata.responderAvatarUrl ?? message.sender?.avatarUrl}
            className="h-6 w-6"
            fallbackClassName="text-[10px] font-semibold"
          />
        </span>
      </UserHoverCard>
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
        <UserHoverCard userId={actorUserId} displayName={displayName}>
          <span className="cursor-pointer font-semibold text-foreground hover:underline underline-offset-2">
            “{actorLabel}”
          </span>
        </UserHoverCard>
        <span className="mx-1">{t("a2ui.in")}</span>
        <span className="font-medium text-foreground">
          “{selectionDisplay.title}”
        </span>
        <span className="mx-1">{t("a2ui.selectedPast")}</span>
        <span className="font-medium text-foreground">
          “{selectionDisplay.selection}”
        </span>
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="shrink-0 text-[11px] text-muted-foreground opacity-70 transition-opacity group-hover/a2ui-response:opacity-100">
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

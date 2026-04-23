import { cn } from "@/lib/utils";

export interface MessageRefChipTarget {
  id: string;
  snippet?: string;
  avatarUrl?: string;
  isDeleted?: boolean;
  forbidden?: boolean;
}

export interface MessageRefChipProps {
  target: MessageRefChipTarget | null;
  parentSource?: "relation" | "thread" | null;
  onNavigate?: (messageId: string) => void;
}

export function MessageRefChip({
  target,
  parentSource,
  onNavigate,
}: MessageRefChipProps) {
  if (!target) return null;

  const disabled = !!(target.isDeleted || target.forbidden);
  const label = target.forbidden
    ? "[无权限]"
    : target.isDeleted
      ? "[已删除]"
      : (target.snippet ?? target.id.slice(0, 8));

  if (disabled) {
    return (
      <span
        data-testid="message-ref-chip"
        aria-disabled="true"
        className={cn(
          "relative inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs",
          "cursor-default text-gray-400 line-through",
        )}
      >
        <span className="max-w-[14rem] truncate">{label}</span>
        {parentSource === "thread" ? (
          <span
            aria-label="thread-derived"
            className="absolute -bottom-1 -right-1 text-[10px]"
            title="来自所属讨论帖"
          >
            🧵
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <button
      data-testid="message-ref-chip"
      type="button"
      onClick={() => onNavigate?.(target.id)}
      className={cn(
        "relative inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs",
        "hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-300",
      )}
    >
      {target.avatarUrl ? (
        <img
          src={target.avatarUrl}
          className="h-4 w-4 rounded-full"
          alt="avatar"
        />
      ) : null}
      <span className="max-w-[14rem] truncate">{label}</span>
      {parentSource === "thread" ? (
        <span
          aria-label="thread-derived"
          className="absolute -bottom-1 -right-1 text-[10px]"
          title="来自所属讨论帖"
        >
          🧵
        </span>
      ) : null}
    </button>
  );
}

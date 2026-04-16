import { useCallback, useEffect } from "react";
import { Sparkles, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAiAutoFillStore } from "@/stores/useAiAutoFillStore";

export interface AiAutoFillButtonProps {
  messageId: string;
  channelId: string;
  fields?: string[];
  size?: "sm" | "default";
  className?: string;
}

const INFO_AUTO_DISMISS_MS = 3000;

export function AiAutoFillButton({
  messageId,
  channelId: _channelId,
  fields,
  size = "sm",
  className,
}: AiAutoFillButtonProps) {
  const entry = useAiAutoFillStore((s) => s.entries.get(messageId));
  const run = useAiAutoFillStore((s) => s.run);
  const dismiss = useAiAutoFillStore((s) => s.dismiss);

  const status = entry?.status;
  const message = entry?.message;
  const settledAt = entry?.settledAt;

  // Auto-dismiss the "info" state after a few seconds across remounts.
  useEffect(() => {
    if (status !== "info" || !settledAt) return;
    const remaining = INFO_AUTO_DISMISS_MS - (Date.now() - settledAt);
    if (remaining <= 0) {
      dismiss(messageId);
      return;
    }
    const t = setTimeout(() => dismiss(messageId), remaining);
    return () => clearTimeout(t);
  }, [status, settledAt, messageId, dismiss]);

  const handleAutoFill = useCallback(() => {
    void run(messageId, { fields, preserveExisting: true });
  }, [messageId, fields, run]);

  const handleDismiss = useCallback(() => {
    dismiss(messageId);
  }, [messageId, dismiss]);

  const loading = status === "loading";
  const iconSize = size === "sm" ? 12 : 14;

  if (status === "error") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1",
          "rounded-full px-2 py-0.5 text-xs font-medium",
          "bg-destructive/10 text-destructive border border-destructive/20",
          className,
        )}
      >
        <Sparkles size={10} />
        <span>{message ?? "AI failed"}</span>
        <button
          onClick={handleDismiss}
          className="ml-0.5 hover:bg-destructive/20 rounded-full p-0.5"
          title="Dismiss"
        >
          <X size={10} />
        </button>
        <button
          onClick={handleAutoFill}
          className="ml-0.5 hover:bg-destructive/20 rounded-full p-0.5"
          title="Retry"
        >
          <Sparkles size={10} />
        </button>
      </span>
    );
  }

  if (status === "info") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1",
          "rounded-full px-2 py-0.5 text-xs font-medium",
          "bg-muted text-muted-foreground border border-border",
          className,
        )}
      >
        <Sparkles size={10} />
        <span>{message ?? "Done"}</span>
      </span>
    );
  }

  return (
    <button
      onClick={handleAutoFill}
      disabled={loading}
      title="AI Generate"
      className={cn(
        "inline-flex items-center justify-center",
        "rounded transition-colors",
        "text-muted-foreground hover:text-foreground",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        size === "sm" ? "px-1.5 py-0.5 text-xs" : "px-2 py-1 text-sm gap-1.5",
        className,
      )}
    >
      {loading ? (
        <Loader2 size={iconSize} className="animate-spin" />
      ) : (
        <Sparkles size={iconSize} />
      )}
      {size === "default" && (
        <span>{loading ? "Generating..." : "AI Generate"}</span>
      )}
    </button>
  );
}

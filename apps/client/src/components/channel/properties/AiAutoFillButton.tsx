import { useState, useCallback } from "react";
import { Sparkles, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { aiAutoFillApi } from "@/services/api/properties";

export interface AiAutoFillButtonProps {
  messageId: string;
  channelId: string;
  fields?: string[];
  size?: "sm" | "default";
  className?: string;
}

export function AiAutoFillButton({
  messageId,
  channelId: _channelId,
  fields,
  size = "sm",
  className,
}: AiAutoFillButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAutoFill = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await aiAutoFillApi.autoFill(messageId, {
        fields,
        preserveExisting: !!fields,
      });
      // The API returns 202 (accepted) — AI processing happens asynchronously.
      // Cache invalidation is handled by the WS `message_property_changed` event
      // when AI finishes, so we intentionally do NOT invalidate queries here.
      // Loading state will be cleared by `finally` below; the actual property
      // update will appear when the WebSocket event triggers a cache refresh.
    } catch {
      setError("AI failed");
    } finally {
      setLoading(false);
    }
  }, [messageId, fields]);

  const dismissError = useCallback(() => {
    setError(null);
  }, []);

  const iconSize = size === "sm" ? 12 : 14;

  // Show persistent failure badge
  if (error) {
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
        <span>{error}</span>
        <button
          onClick={dismissError}
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

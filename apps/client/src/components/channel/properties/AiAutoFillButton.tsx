import { useState, useCallback, useEffect } from "react";
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

const INFO_AUTO_DISMISS_MS = 3000;

export function AiAutoFillButton({
  messageId,
  channelId: _channelId,
  fields,
  size = "sm",
  className,
}: AiAutoFillButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (!info) return;
    const t = setTimeout(() => setInfo(null), INFO_AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [info]);

  const handleAutoFill = useCallback(async () => {
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const result = await aiAutoFillApi.autoFill(messageId, {
        fields,
        preserveExisting: true,
      });
      // The WS `message_property_changed` event refreshes the property cache on
      // successful fills, so no query invalidation is needed here. When the AI
      // fills nothing (all fields preserved or marked unchanged), no WS event
      // fires — surface a short "nothing to fill" badge so the click is not
      // a silent no-op.
      if (Object.keys(result.filled).length === 0) {
        setInfo("Nothing to fill");
      }
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

  if (info) {
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
        <span>{info}</span>
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

import { useState, useCallback } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { aiAutoFillApi } from "@/services/api/properties";
import { messagePropertyKeys } from "@/hooks/useMessageProperties";

export interface AiAutoFillButtonProps {
  messageId: string;
  channelId: string;
  fields?: string[];
  size?: "sm" | "default";
  className?: string;
}

export function AiAutoFillButton({
  messageId,
  channelId,
  fields,
  size = "sm",
  className,
}: AiAutoFillButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const handleAutoFill = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await aiAutoFillApi.autoFill(messageId, {
        fields,
        preserveExisting: !!fields,
      });
      // Invalidate queries to refresh properties
      queryClient.invalidateQueries({
        queryKey: messagePropertyKeys.all(messageId),
      });
      queryClient.invalidateQueries({
        queryKey: ["messages", channelId],
      });
    } catch {
      setError("AI fill failed");
    } finally {
      setLoading(false);
    }
  }, [messageId, channelId, fields, queryClient]);

  const iconSize = size === "sm" ? 12 : 14;

  return (
    <button
      onClick={handleAutoFill}
      disabled={loading}
      title={error ?? "AI Generate"}
      className={cn(
        "inline-flex items-center justify-center",
        "rounded transition-colors",
        "text-muted-foreground hover:text-foreground",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        size === "sm" ? "px-1.5 py-0.5 text-xs" : "px-2 py-1 text-sm gap-1.5",
        error && "text-destructive",
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

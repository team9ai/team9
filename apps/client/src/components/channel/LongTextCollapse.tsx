import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { useFullContent } from "@/hooks/useMessages";
import type { Message } from "@/types/im";

interface LongTextCollapseProps {
  message: Message;
  children: React.ReactNode;
}

const COLLAPSED_MAX_HEIGHT = "15rem"; // ~10 lines at 1.5rem line-height

export function LongTextCollapse({ message, children }: LongTextCollapseProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [fetchEnabled, setFetchEnabled] = useState(false);
  const queryClient = useQueryClient();

  const {
    data: fullContentData,
    isLoading,
    isError,
  } = useFullContent(message.id, fetchEnabled && !!message.isTruncated);

  const remainingChars = message.fullContentLength
    ? message.fullContentLength - (message.content?.length ?? 0)
    : 0;

  const handleExpand = useCallback(() => {
    if (message.isTruncated) {
      setFetchEnabled(true);
    }
    setIsExpanded(true);
  }, [message.isTruncated]);

  const handleRetry = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: ["message-full-content", message.id],
    });
  }, [queryClient, message.id]);

  const isContentReady = !message.isTruncated || !!fullContentData;
  const shouldShowFull = isExpanded && isContentReady;

  return (
    <div className="relative">
      <div
        className="overflow-hidden transition-[max-height] duration-300 ease-in-out"
        style={{
          maxHeight: shouldShowFull ? "none" : COLLAPSED_MAX_HEIGHT,
        }}
      >
        {children}
      </div>

      {/* Gradient overlay when collapsed */}
      {!shouldShowFull && (
        <div
          className="absolute bottom-0 left-0 right-0 h-16 pointer-events-none"
          style={{
            background: "linear-gradient(transparent, hsl(var(--background)))",
          }}
        />
      )}

      {/* Expand button */}
      {!isExpanded && (
        <button
          type="button"
          onClick={handleExpand}
          className="mt-1 flex items-center gap-1 text-xs text-info hover:text-info/80 transition-colors"
        >
          <ChevronDown size={14} />
          <span>
            展开全文
            {remainingChars > 0 &&
              `（还有约 ${formatCharCount(remainingChars)} 字）`}
          </span>
        </button>
      )}

      {/* Loading state */}
      {isExpanded && isLoading && !isContentReady && (
        <div className="mt-1 text-xs text-muted-foreground animate-pulse">
          加载中...
        </div>
      )}

      {/* Error state */}
      {isExpanded && isError && (
        <button
          type="button"
          onClick={handleRetry}
          className="mt-1 text-xs text-destructive hover:text-destructive/80 transition-colors"
        >
          加载失败，点击重试
        </button>
      )}
    </div>
  );
}

function formatCharCount(count: number): string {
  if (count >= 10000) return `${Math.round(count / 1000)}k`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return String(count);
}

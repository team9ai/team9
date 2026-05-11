import {
  useState,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  memo,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";
import { useFullContent } from "@/hooks/useMessages";
import type { Message } from "@/types/im";

interface LongTextCollapseProps {
  message: Message;
  children: React.ReactNode;
}

const COLLAPSED_MAX_HEIGHT_PX = 240; // 15rem at the app's 16px base size
const COLLAPSED_MAX_HEIGHT = `${COLLAPSED_MAX_HEIGHT_PX}px`;
const OVERFLOW_TOLERANCE_PX = 1;

export const LongTextCollapse = memo(
  function LongTextCollapse({ message, children }: LongTextCollapseProps) {
    const { t } = useTranslation("message");
    const [isExpanded, setIsExpanded] = useState(false);
    const [fetchEnabled, setFetchEnabled] = useState(false);
    const [hasVisualOverflow, setHasVisualOverflow] = useState(false);
    const contentRef = useRef<HTMLDivElement>(null);
    const queryClient = useQueryClient();

    const {
      data: fullContentData,
      isLoading,
      isError,
    } = useFullContent(message.id, fetchEnabled && !!message.isTruncated);

    // Auto-expand once full content is fetched
    useEffect(() => {
      if (fullContentData) {
        setIsExpanded(true);
      }
    }, [fullContentData]);

    useLayoutEffect(() => {
      const el = contentRef.current;
      if (!el) return;

      const measureOverflow = () => {
        const next =
          el.scrollHeight > COLLAPSED_MAX_HEIGHT_PX + OVERFLOW_TOLERANCE_PX;
        setHasVisualOverflow((prev) => (prev === next ? prev : next));
      };

      measureOverflow();

      const imageElements = Array.from(el.querySelectorAll("img"));
      imageElements.forEach((image) => {
        if (!image.complete) {
          image.addEventListener("load", measureOverflow);
        }
      });

      const observer =
        typeof ResizeObserver === "undefined"
          ? null
          : new ResizeObserver(measureOverflow);
      observer?.observe(el);

      return () => {
        observer?.disconnect();
        imageElements.forEach((image) => {
          image.removeEventListener("load", measureOverflow);
        });
      };
    }, [children, fullContentData, message.id]);

    const remainingChars = message.fullContentLength
      ? message.fullContentLength - (message.content?.length ?? 0)
      : 0;

    const handleExpand = useCallback(() => {
      if (message.isTruncated) {
        setFetchEnabled(true);
        // Don't set isExpanded here — useEffect will do it when data arrives
      } else {
        setIsExpanded(true);
      }
    }, [message.isTruncated]);

    const handleRetry = useCallback(() => {
      queryClient.invalidateQueries({
        queryKey: ["message-full-content", message.id],
      });
    }, [queryClient, message.id]);

    const isContentReady = !message.isTruncated || !!fullContentData;
    const shouldOfferExpand =
      message.type === "long_text" ||
      !!message.isTruncated ||
      hasVisualOverflow;
    const shouldShowFull = !shouldOfferExpand || (isExpanded && isContentReady);

    return (
      <div className="relative">
        <div
          ref={contentRef}
          className={
            shouldOfferExpand
              ? "overflow-hidden transition-[max-height] duration-300 ease-in-out"
              : undefined
          }
          style={
            shouldOfferExpand
              ? {
                  maxHeight: shouldShowFull ? "9999px" : COLLAPSED_MAX_HEIGHT,
                }
              : undefined
          }
        >
          {children}
        </div>

        {/* Gradient overlay when collapsed */}
        {shouldOfferExpand && !shouldShowFull && (
          <div
            className="absolute bottom-0 left-0 right-0 h-16 pointer-events-none"
            style={{
              background:
                "linear-gradient(transparent, hsl(var(--background)))",
            }}
          />
        )}

        {/* Expand button — visible when not expanded and fetch not initiated */}
        {shouldOfferExpand && !isExpanded && !fetchEnabled && (
          <button
            type="button"
            onClick={handleExpand}
            className="relative z-10 mt-1 flex items-center gap-1 bg-background text-xs text-info hover:text-info/80 transition-colors"
          >
            <ChevronDown size={14} />
            <span>
              {t("expandFullContent")}
              {remainingChars > 0 &&
                t("remainingChars", { chars: formatCharCount(remainingChars) })}
            </span>
          </button>
        )}

        {/* Loading state — show while fetching, before expand */}
        {fetchEnabled && isLoading && (
          <div className="relative z-10 mt-1 bg-background text-xs text-muted-foreground animate-pulse">
            {t("loadingFullContent")}
          </div>
        )}

        {/* Error state */}
        {fetchEnabled && isError && (
          <button
            type="button"
            onClick={handleRetry}
            className="relative z-10 mt-1 bg-background text-xs text-destructive hover:text-destructive/80 transition-colors"
          >
            {t("loadFullContentFailed")}
          </button>
        )}
      </div>
    );
  },
  (prev, next) => {
    return (
      prev.message.id === next.message.id &&
      prev.message.type === next.message.type &&
      prev.message.isTruncated === next.message.isTruncated &&
      prev.message.fullContentLength === next.message.fullContentLength &&
      prev.message.content?.length === next.message.content?.length &&
      prev.children === next.children
    );
  },
);

function formatCharCount(count: number): string {
  if (count >= 10000) return `${Math.round(count / 1000)}k`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return String(count);
}

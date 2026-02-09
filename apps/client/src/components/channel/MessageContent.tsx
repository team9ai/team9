import {
  useMemo,
  useRef,
  useState,
  useCallback,
  useEffect,
  memo,
  forwardRef,
} from "react";
import { useNavigate } from "@tanstack/react-router";
import linkifyHtml from "linkify-html";
import { UserProfileCard } from "./UserProfileCard";
import { useCreateDirectChannel } from "@/hooks/useChannels";

interface MessageContentProps {
  content: string;
  className?: string;
}

interface HoveredMention {
  userId: string;
  displayName: string;
  rect: DOMRect;
}

/**
 * Inner component that only renders the HTML.
 * Wrapped with React.memo so it NEVER re-renders when the parent's
 * hover state changes — this prevents the DOM from being touched
 * and eliminates the :hover CSS flicker.
 */
const MentionContentInner = memo(
  forwardRef<HTMLDivElement, { html: string; className?: string }>(
    function MentionContentInner({ html, className }, ref) {
      return (
        <div
          ref={ref}
          className={className}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      );
    },
  ),
);

/**
 * Renders message content with HTML formatting support.
 * Handles both plain text (legacy) and HTML formatted messages.
 * Converts <mention> tags to interactive mention spans with hover profile card and click-to-DM.
 */
export function MessageContent({ content, className }: MessageContentProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredMention, setHoveredMention] = useState<HoveredMention | null>(
    null,
  );
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const navigate = useNavigate();
  const createDirectChannel = useCreateDirectChannel();

  // Use refs to avoid stale closures in event listeners
  const navigateRef = useRef(navigate);
  const createDirectChannelRef = useRef(createDirectChannel);
  navigateRef.current = navigate;
  createDirectChannelRef.current = createDirectChannel;

  const processedContent = useMemo(() => {
    const isHtml = /<[^>]+>/.test(content);

    let html: string;

    if (!isHtml) {
      html = escapeHtml(content).replace(/\n/g, "<br>");
    } else {
      html = content;

      // Convert <mention> tags to styled spans with data attributes for interactivity
      html = html.replace(
        /<mention data-user-id="([^"]*)" data-display-name="([^"]*)">@&lt;[^&]*&gt;<\/mention>/g,
        '<span class="mention-tag" data-mention-user-id="$1" data-mention-display-name="$2">@$2</span>',
      );

      // Backward compatibility: plain @<userId> format
      html = html.replace(
        /@&lt;([a-f0-9-]+)&gt;/gi,
        '<span class="mention-tag">@User</span>',
      );
    }

    html = linkifyHtml(html, {
      target: "_blank",
      rel: "noopener noreferrer",
      className: "message-link",
    });

    return html;
  }, [content]);

  // Event delegation on container for mention hover and click.
  // Uses [] dependency — delegation works regardless of content changes.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleMouseOver = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest<HTMLElement>(
        "[data-mention-user-id]",
      );
      if (!target) return;

      // Simulate mouseenter: ignore if coming from within the same mention
      const related = e.relatedTarget as HTMLElement | null;
      if (related && target.contains(related)) return;

      clearTimeout(hideTimerRef.current);
      clearTimeout(showTimerRef.current);

      showTimerRef.current = setTimeout(() => {
        const userId = target.getAttribute("data-mention-user-id")!;
        const displayName =
          target.getAttribute("data-mention-display-name") || "User";
        const rect = target.getBoundingClientRect();
        setHoveredMention({ userId, displayName, rect });
      }, 300);
    };

    const handleMouseOut = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest<HTMLElement>(
        "[data-mention-user-id]",
      );
      if (!target) return;

      // Simulate mouseleave: ignore if moving within the same mention
      const related = e.relatedTarget as HTMLElement | null;
      if (related && target.contains(related)) return;

      clearTimeout(showTimerRef.current);
      hideTimerRef.current = setTimeout(() => {
        setHoveredMention(null);
      }, 200);
    };

    const handleClick = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest<HTMLElement>(
        "[data-mention-user-id]",
      );
      if (!target) return;

      // Don't trigger navigation if user is selecting text
      const selection = window.getSelection();
      if (selection && selection.toString().length > 0) return;

      e.preventDefault();
      e.stopPropagation();

      const userId = target.getAttribute("data-mention-user-id");
      if (userId) {
        createDirectChannelRef.current
          .mutateAsync(userId)
          .then((channel) => {
            navigateRef.current({
              to: "/channels/$channelId",
              params: { channelId: channel.id },
            });
          })
          .catch((error: unknown) => {
            console.error("Failed to create direct channel:", error);
          });
      }
    };

    el.addEventListener("mouseover", handleMouseOver);
    el.addEventListener("mouseout", handleMouseOut);
    el.addEventListener("click", handleClick);

    return () => {
      el.removeEventListener("mouseover", handleMouseOver);
      el.removeEventListener("mouseout", handleMouseOut);
      el.removeEventListener("click", handleClick);
      clearTimeout(showTimerRef.current);
      clearTimeout(hideTimerRef.current);
    };
  }, []);

  const handleCardMouseEnter = useCallback(() => {
    clearTimeout(hideTimerRef.current);
  }, []);

  const handleCardMouseLeave = useCallback(() => {
    hideTimerRef.current = setTimeout(() => {
      setHoveredMention(null);
    }, 200);
  }, []);

  return (
    <>
      <MentionContentInner
        ref={containerRef}
        html={processedContent}
        className={className}
      />
      {hoveredMention && (
        <UserProfileCard
          userId={hoveredMention.userId}
          displayName={hoveredMention.displayName}
          anchorRect={hoveredMention.rect}
          onMouseEnter={handleCardMouseEnter}
          onMouseLeave={handleCardMouseLeave}
        />
      )}
    </>
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

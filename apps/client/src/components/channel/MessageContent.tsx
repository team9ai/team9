import {
  useMemo,
  useRef,
  useState,
  useCallback,
  useEffect,
  memo,
  forwardRef,
  type ComponentPropsWithoutRef,
} from "react";
import { useNavigate } from "@tanstack/react-router";
import { useFullContent } from "@/hooks/useMessages";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import linkifyHtml from "linkify-html";
import Prism from "@/lib/prism";
import { UserProfileCard } from "./UserProfileCard";
import { CodeBlock } from "./CodeBlock";
import { ImagePreviewDialog } from "./ImagePreviewDialog";
import { LongTextCollapse } from "./LongTextCollapse";
import { useCreateDirectChannel } from "@/hooks/useChannels";
import { SelectionCopyPopup } from "./SelectionCopyPopup";
import type { Message } from "@/types/im";

interface MessageContentProps {
  content: string;
  className?: string;
  message?: Message;
}

interface HoveredMention {
  userId: string;
  displayName: string;
  rect: DOMRect;
}

interface MarkdownNodePosition {
  start?: { line?: number };
  end?: { line?: number };
}

interface MarkdownNode {
  type?: string;
  tagName?: string;
  position?: MarkdownNodePosition;
  children?: MarkdownNode[];
}

type MarkdownParagraphProps = ComponentPropsWithoutRef<"p"> & {
  node?: MarkdownNode;
};

type MarkdownCodeProps = ComponentPropsWithoutRef<"code"> & {
  node?: MarkdownNode;
};

// Detect HTML content from the Lexical editor
const HTML_TAG_PATTERN =
  /<(?:p|strong|em|u|s|code|mention|ul|ol|li|br|pre|a|blockquote|h[1-6])\b/i;

/**
 * Inner component that only renders the HTML.
 * Wrapped with React.memo so it NEVER re-renders when the parent's
 * hover state changes — this prevents the DOM from being touched
 * and eliminates the :hover CSS flicker.
 */
const HtmlContentInner = memo(
  forwardRef<HTMLDivElement, { html: string; className?: string }>(
    function HtmlContentInner({ html, className }, ref) {
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
 * Renders HTML messages (from Lexical editor) with mention interactivity
 * and Prism.js code highlighting for <pre><code> blocks.
 */
function HtmlMessageContent({ content, className }: MessageContentProps) {
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
    let html = content;

    // Convert <mention> tags to styled spans with data attributes for interactivity
    html = html.replace(
      /<mention data-user-id="([^"]*)" data-display-name="([^"]*)"[^>]*>@&lt;[^&]*&gt;<\/mention>/g,
      '<span class="mention-tag" data-mention-user-id="$1" data-mention-display-name="$2">@$2</span>',
    );

    // Backward compatibility: plain @<userId> format
    html = html.replace(
      /@&lt;([a-f0-9-]+)&gt;/gi,
      '<span class="mention-tag">@User</span>',
    );

    // Highlight code blocks with Prism.js
    html = html.replace(
      /<pre><code class="language-([^"]*)">([\s\S]*?)<\/code><\/pre>/g,
      (_, lang, code) => {
        const decodedCode = decodeHtmlEntities(code);
        const grammar = Prism.languages[lang];
        const highlighted = grammar
          ? Prism.highlight(decodedCode, grammar, lang)
          : escapeHtml(decodedCode);
        const encodedForAttr = encodeURIComponent(decodedCode);
        return `<div class="code-block-wrapper"><div class="code-block-header"><span class="code-block-language">${escapeHtml(lang || "text")}</span><button type="button" class="code-block-copy" data-code="${encodedForAttr}">Copy</button></div><pre class="code-block-pre"><code class="language-${escapeHtml(lang)}">${highlighted}</code></pre></div>`;
      },
    );

    html = linkifyHtml(html, {
      target: "_blank",
      rel: "noopener noreferrer",
      className: "message-link",
    });

    return html;
  }, [content]);

  // Event delegation on container for mention hover/click and code copy button.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleMouseOver = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest<HTMLElement>(
        "[data-mention-user-id]",
      );
      if (!target) return;

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

      const related = e.relatedTarget as HTMLElement | null;
      if (related && target.contains(related)) return;

      clearTimeout(showTimerRef.current);
      hideTimerRef.current = setTimeout(() => {
        setHoveredMention(null);
      }, 200);
    };

    const handleClick = (e: MouseEvent) => {
      // Handle copy button clicks in code blocks
      const copyBtn = (e.target as HTMLElement).closest<HTMLElement>(
        ".code-block-copy",
      );
      if (copyBtn) {
        e.preventDefault();
        e.stopPropagation();
        const code = copyBtn.dataset.code
          ? decodeURIComponent(copyBtn.dataset.code)
          : "";
        navigator.clipboard.writeText(code);
        copyBtn.textContent = "Copied!";
        setTimeout(() => {
          copyBtn.textContent = "Copy";
        }, 2000);
        return;
      }

      // Handle mention clicks
      const mentionTarget = (e.target as HTMLElement).closest<HTMLElement>(
        "[data-mention-user-id]",
      );
      if (!mentionTarget) return;

      const selection = window.getSelection();
      if (selection && selection.toString().length > 0) return;

      e.preventDefault();
      e.stopPropagation();

      const userId = mentionTarget.getAttribute("data-mention-user-id");
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
      <HtmlContentInner
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

/**
 * Renders plain text / Markdown messages (from bots/API) using react-markdown.
 */
function MarkdownMessageContent({ content, className }: MessageContentProps) {
  const [previewImage, setPreviewImage] = useState<{
    src: string;
    alt: string;
  } | null>(null);

  return (
    <div className={`${className ?? ""} markdown-message-content`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code: MarkdownCodeRenderer,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="message-link"
            >
              {children}
            </a>
          ),
          img: ({ src, alt }) => (
            <img
              src={src}
              alt={alt || ""}
              className="markdown-image"
              loading="lazy"
              onClick={() => src && setPreviewImage({ src, alt: alt || "" })}
            />
          ),
          // Prevent react-markdown from wrapping images in <p> tags that break layout
          p: ({ children, node }: MarkdownParagraphProps) => {
            const hasImage = node?.children?.some(
              (child) => child.type === "element" && child.tagName === "img",
            );
            if (hasImage) {
              return <>{children}</>;
            }
            return <p>{children}</p>;
          },
        }}
      >
        {content}
      </ReactMarkdown>

      {previewImage && (
        <ImagePreviewDialog
          src={previewImage.src}
          alt={previewImage.alt}
          open={true}
          onOpenChange={(open) => {
            if (!open) setPreviewImage(null);
          }}
        />
      )}
    </div>
  );
}

function MarkdownCodeRenderer({
  className,
  children,
  node,
  ...props
}: MarkdownCodeProps) {
  const match = /language-(\w+)/.exec(className || "");
  const code = String(children).replace(/\n$/, "");
  const firstChild = node?.children?.[0];

  // Check if this is a block code (has a language class or is inside <pre>)
  const isBlock =
    !!match ||
    (node?.position &&
      firstChild?.position?.start?.line !== firstChild?.position?.end?.line);

  // Determine if parent is <pre> — react-markdown wraps code blocks in <pre>
  if (isBlock || code.includes("\n")) {
    return <CodeBlock code={code} language={match?.[1] || ""} />;
  }

  // Inline code
  return (
    <code className="inline-code" {...props}>
      {children}
    </code>
  );
}

/**
 * Renders message content with HTML formatting or Markdown support.
 * - HTML messages (from Lexical editor): rendered with dangerouslySetInnerHTML + Prism code highlighting
 * - Plain text / Markdown messages (from bots/API): rendered with react-markdown
 */
export function MessageContent({
  content,
  className,
  message,
}: MessageContentProps) {
  // For long_text messages, reactively subscribe to the full-content cache.
  // enabled: false means this hook never initiates a fetch — LongTextCollapse
  // handles that. But it does subscribe to cache updates, so when the full
  // content arrives, this component re-renders with the complete text.
  const { data: fullContentData } = useFullContent(
    message?.id ?? "",
    false, // never fetch from here — LongTextCollapse controls fetching
  );
  const displayContent =
    message?.type === "long_text" && fullContentData?.content
      ? fullContentData.content
      : content;

  const isHtml = HTML_TAG_PATTERN.test(displayContent);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [selectionState, setSelectionState] = useState<{
    rect: DOMRect;
    text: string;
  } | null>(null);

  // Memoize content element so selectionState changes don't re-render
  // the inner content components (which would destroy DOM and clear selection)
  const contentElement = useMemo(
    () =>
      isHtml ? (
        <HtmlMessageContent content={displayContent} className={className} />
      ) : (
        <MarkdownMessageContent
          content={displayContent}
          className={className}
        />
      ),
    [isHtml, displayContent, className],
  );

  // Wrap in LongTextCollapse for long_text messages.
  // Intentionally using stable primitive deps instead of the full `message` object
  // to avoid re-renders when React Query returns a new object reference.
  const wrappedElement = useMemo(
    () => {
      if (message?.type === "long_text") {
        return (
          <LongTextCollapse message={message}>
            {contentElement}
          </LongTextCollapse>
        );
      }
      return contentElement;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      message?.id,
      message?.type,
      message?.isTruncated,
      message?.fullContentLength,
      message?.content?.length,
      contentElement,
    ],
  );

  const handleMouseUp = useCallback(() => {
    // Small delay to let browser finalize selection
    setTimeout(() => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.toString().trim()) {
        return;
      }

      // Verify selection is within this message container
      const range = selection.getRangeAt(0);
      if (!wrapperRef.current?.contains(range.commonAncestorContainer)) {
        return;
      }

      const rect = range.getBoundingClientRect();
      setSelectionState({ rect, text: selection.toString() });
    }, 10);
  }, []);

  const handleDismiss = useCallback(() => {
    setSelectionState(null);
  }, []);

  return (
    <div ref={wrapperRef} onMouseUp={handleMouseUp}>
      {wrappedElement}
      {selectionState && (
        <SelectionCopyPopup
          anchorRect={selectionState.rect}
          selectedText={selectionState.text}
          onDismiss={handleDismiss}
        />
      )}
    </div>
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

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");
}

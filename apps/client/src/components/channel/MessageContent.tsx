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
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import linkifyHtml from "linkify-html";
import Prism from "prismjs";
import { UserProfileCard } from "./UserProfileCard";
import { CodeBlock } from "./CodeBlock";
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

// Detect HTML content from the Lexical editor
const HTML_TAG_PATTERN =
  /<(?:p|strong|em|u|s|code|mention|ul|ol|li|br|pre|a|h[1-6])\b/i;

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
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function MarkdownCodeRenderer({ className, children, node, ...props }: any) {
  const match = /language-(\w+)/.exec(className || "");
  const code = String(children).replace(/\n$/, "");

  // Check if this is a block code (has a language class or is inside <pre>)
  const isBlock =
    match ||
    (node?.position &&
      node?.children?.[0]?.position?.start.line !==
        node?.children?.[0]?.position?.end.line);

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
export function MessageContent({ content, className }: MessageContentProps) {
  const isHtml = HTML_TAG_PATTERN.test(content);

  if (isHtml) {
    return <HtmlMessageContent content={content} className={className} />;
  }

  return <MarkdownMessageContent content={content} className={className} />;
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

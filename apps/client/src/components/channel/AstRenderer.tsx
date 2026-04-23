import {
  Fragment,
  memo,
  useState,
  useCallback,
  useMemo,
  useRef,
  useEffect,
} from "react";
import type { ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { find as linkifyFind } from "linkifyjs";
import { UserProfileCard } from "./UserProfileCard";
import { useCreateDirectChannel } from "@/hooks/useChannels";

// XSS-safe renderer for Lexical serialized EditorState.
//
// Why this exists: the previous HTML-string path had to be sanitized with
// DOMPurify because `dangerouslySetInnerHTML` would execute any attacker
// payload the sanitizer missed. This renderer walks the AST and produces
// React elements directly — attacker-controlled `text` fields become React
// text nodes (never parsed as HTML), attacker-controlled `type` fields that
// aren't in our known-set simply fall into an `unknown-node` branch that
// renders children-only. There is no DOM sink to exploit.

// Lexical format bitmask, mirrors exportContent.ts.
const FORMAT_BOLD = 1;
const FORMAT_ITALIC = 2;
const FORMAT_STRIKETHROUGH = 4;
const FORMAT_UNDERLINE = 8;
const FORMAT_CODE = 16;

// Mirrors the backend normalizeAst() depth cap. Bounds recursion so a
// malformed AST (malicious row, row written before validation was in place,
// or a future bug in the sanitizer) can never blow the renderer stack.
const MAX_RENDER_DEPTH = 32;

interface LexicalNode {
  type?: string;
  children?: LexicalNode[];
  text?: string;
  format?: number | string;
  tag?: string;
  listType?: "bullet" | "number" | "check";
  language?: string;
  highlightType?: string;
  // Mention node
  userId?: string;
  displayName?: string;
  userType?: string;
  [key: string]: unknown;
}

interface AstRendererProps {
  ast: unknown;
  className?: string;
}

export const AstRenderer = memo(function AstRenderer({
  ast,
  className,
}: AstRendererProps) {
  const [hoveredMention, setHoveredMention] = useState<{
    userId: string;
    displayName: string;
    rect: DOMRect;
  } | null>(null);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const navigate = useNavigate();
  const createDirectChannel = useCreateDirectChannel();

  useEffect(() => {
    return () => {
      if (showTimerRef.current) clearTimeout(showTimerRef.current);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  const handleMentionEnter = useCallback(
    (userId: string, displayName: string, el: HTMLElement) => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      if (showTimerRef.current) clearTimeout(showTimerRef.current);
      showTimerRef.current = setTimeout(() => {
        setHoveredMention({
          userId,
          displayName,
          rect: el.getBoundingClientRect(),
        });
      }, 300);
    },
    [],
  );

  const handleMentionLeave = useCallback(() => {
    if (showTimerRef.current) clearTimeout(showTimerRef.current);
    hideTimerRef.current = setTimeout(() => setHoveredMention(null), 200);
  }, []);

  const handleMentionClick = useCallback(
    (userId: string) => {
      createDirectChannel
        .mutateAsync(userId)
        .then((channel) => {
          navigate({
            to: "/channels/$channelId",
            params: { channelId: channel.id },
          });
        })
        .catch((err: unknown) => {
          console.error("Failed to open DM from mention:", err);
        });
    },
    [createDirectChannel, navigate],
  );

  const handleCardEnter = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
  }, []);

  const handleCardLeave = useCallback(() => {
    hideTimerRef.current = setTimeout(() => setHoveredMention(null), 200);
  }, []);

  const root = useMemo(() => {
    if (!ast || typeof ast !== "object") return null;
    const maybeRoot = (ast as { root?: unknown }).root;
    if (!maybeRoot || typeof maybeRoot !== "object") return null;
    return maybeRoot as LexicalNode;
  }, [ast]);

  if (!root) return null;

  const content = (
    <div className={className}>
      {renderNodes(
        root.children ?? [],
        {
          onMentionEnter: handleMentionEnter,
          onMentionLeave: handleMentionLeave,
          onMentionClick: handleMentionClick,
        },
        1,
      )}
    </div>
  );

  return (
    <>
      {content}
      {hoveredMention && (
        <UserProfileCard
          userId={hoveredMention.userId}
          displayName={hoveredMention.displayName}
          anchorRect={hoveredMention.rect}
          onMouseEnter={handleCardEnter}
          onMouseLeave={handleCardLeave}
        />
      )}
    </>
  );
});

interface RenderCtx {
  onMentionEnter: (
    userId: string,
    displayName: string,
    el: HTMLElement,
  ) => void;
  onMentionLeave: () => void;
  onMentionClick: (userId: string) => void;
}

function renderNodes(
  nodes: LexicalNode[] | unknown,
  ctx: RenderCtx,
  depth: number,
): ReactNode[] {
  if (depth > MAX_RENDER_DEPTH) return [];
  if (!Array.isArray(nodes)) return [];
  return nodes.map((node, idx) => (
    <Fragment key={idx}>{renderNode(node as LexicalNode, ctx, depth)}</Fragment>
  ));
}

function renderNode(
  node: LexicalNode,
  ctx: RenderCtx,
  depth: number,
): ReactNode {
  if (depth > MAX_RENDER_DEPTH) return null;
  const type = node.type;

  switch (type) {
    case "text":
      return renderTextNode(node);

    case "linebreak":
      return <br />;

    case "mention":
      return renderMention(node, ctx);

    case "paragraph": {
      const children = node.children ?? [];
      if (children.length === 0) return <p>{" "}</p>;
      return <p>{renderNodes(children, ctx, depth + 1)}</p>;
    }

    case "heading": {
      const tag = typeof node.tag === "string" ? node.tag : "h3";
      const Tag = ALLOWED_HEADING_TAGS.has(tag)
        ? (tag as "h1" | "h2" | "h3" | "h4" | "h5" | "h6")
        : "h3";
      return <Tag>{renderNodes(node.children ?? [], ctx, depth + 1)}</Tag>;
    }

    case "quote":
      return (
        <blockquote>
          {renderNodes(node.children ?? [], ctx, depth + 1)}
        </blockquote>
      );

    case "list": {
      const ordered = node.listType === "number";
      const Tag = ordered ? "ol" : "ul";
      return <Tag>{renderNodes(node.children ?? [], ctx, depth + 1)}</Tag>;
    }

    case "listitem":
      return <li>{renderNodes(node.children ?? [], ctx, depth + 1)}</li>;

    case "code": {
      const lang = typeof node.language === "string" ? node.language : "";
      return (
        <pre className={lang ? `language-${lang}` : undefined}>
          <code className={lang ? `language-${lang}` : undefined}>
            {renderNodes(node.children ?? [], ctx, depth + 1)}
          </code>
        </pre>
      );
    }

    case "code-highlight":
      return renderCodeHighlight(node);

    case "link": {
      // Lexical LinkNode has url + rel + target; we treat them as untrusted
      // attributes and only accept http(s)/mailto schemes.
      const url = typeof node.url === "string" ? node.url : "";
      if (!isSafeHref(url)) {
        return <>{renderNodes(node.children ?? [], ctx, depth + 1)}</>;
      }
      return (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="message-link"
        >
          {renderNodes(node.children ?? [], ctx, depth + 1)}
        </a>
      );
    }

    default:
      // Unknown node type — render children transparently so nothing breaks,
      // but ignore any custom data. No HTML sink is reachable from here.
      if (node.children)
        return <>{renderNodes(node.children, ctx, depth + 1)}</>;
      return null;
  }
}

const ALLOWED_HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

function renderTextNode(node: LexicalNode): ReactNode {
  const raw = typeof node.text === "string" ? node.text : "";
  if (!raw) return null;
  const format = typeof node.format === "number" ? node.format : 0;
  // Linkify: split text into URL / non-URL spans. This produces React
  // elements, so the URL goes through an `href` attribute (which we
  // validate) rather than a string sink.
  const pieces = linkifyText(raw);
  return wrapWithFormat(pieces, format);
}

function linkifyText(text: string): ReactNode[] {
  const matches = linkifyFind(text);
  if (!matches.length) return [text];
  const out: ReactNode[] = [];
  let cursor = 0;
  matches.forEach((m, i) => {
    if (m.start > cursor) out.push(text.slice(cursor, m.start));
    if (isSafeHref(m.href)) {
      out.push(
        <a
          key={`url-${i}`}
          href={m.href}
          target="_blank"
          rel="noopener noreferrer"
          className="message-link"
        >
          {m.value}
        </a>,
      );
    } else {
      out.push(m.value);
    }
    cursor = m.end;
  });
  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}

function wrapWithFormat(children: ReactNode[], format: number): ReactNode {
  let node: ReactNode = <>{children}</>;
  if (format & FORMAT_CODE) node = <code className="inline-code">{node}</code>;
  if (format & FORMAT_UNDERLINE) node = <u>{node}</u>;
  if (format & FORMAT_STRIKETHROUGH) node = <s>{node}</s>;
  if (format & FORMAT_ITALIC) node = <em>{node}</em>;
  if (format & FORMAT_BOLD) node = <strong>{node}</strong>;
  return node;
}

function renderMention(node: LexicalNode, ctx: RenderCtx): ReactNode {
  const userId = typeof node.userId === "string" ? node.userId : "";
  const displayName =
    typeof node.displayName === "string" ? node.displayName : "User";
  if (!userId) return <>@{displayName}</>;
  return (
    <span
      className="mention-tag"
      data-mention-user-id={userId}
      data-mention-display-name={displayName}
      onMouseEnter={(e) =>
        ctx.onMentionEnter(userId, displayName, e.currentTarget)
      }
      onMouseLeave={ctx.onMentionLeave}
      onClick={(e) => {
        const sel = window.getSelection();
        if (sel && sel.toString().length > 0) return;
        e.preventDefault();
        e.stopPropagation();
        ctx.onMentionClick(userId);
      }}
    >
      @{displayName}
    </span>
  );
}

function renderCodeHighlight(node: LexicalNode): ReactNode {
  const text = typeof node.text === "string" ? node.text : "";
  const highlightType =
    typeof node.highlightType === "string" ? node.highlightType : "";
  if (!highlightType) return text;
  return <span className={`token ${highlightType}`}>{text}</span>;
}

// Only allow URLs we're sure can't execute JS. Matches the shape we permit in
// the sanitizer (http/https/mailto/tel). Everything else renders as plain text.
function isSafeHref(href: string): boolean {
  if (!href) return false;
  const trimmed = href.trim();
  const lower = trimmed.toLowerCase();
  return (
    lower.startsWith("http://") ||
    lower.startsWith("https://") ||
    lower.startsWith("mailto:") ||
    lower.startsWith("tel:")
  );
}

import { useMemo } from "react";
import linkifyHtml from "linkify-html";

interface MessageContentProps {
  content: string;
  className?: string;
}

/**
 * Renders message content with HTML formatting support.
 * Handles both plain text (legacy) and HTML formatted messages.
 * Converts <mention> tags to styled mention spans.
 */
export function MessageContent({ content, className }: MessageContentProps) {
  const processedContent = useMemo(() => {
    // Check if content contains HTML tags
    const isHtml = /<[^>]+>/.test(content);

    let html: string;

    if (!isHtml) {
      // Plain text - just escape and convert newlines
      html = escapeHtml(content).replace(/\n/g, "<br>");
    } else {
      // Process HTML content
      html = content;

      // Convert <mention> tags to styled spans
      html = html.replace(
        /<mention data-user-id="([^"]*)" data-display-name="([^"]*)">@&lt;[^&]*&gt;<\/mention>/g,
        '<span class="mention-tag">@$2</span>',
      );

      // Also handle @<userId> in plain text for backward compatibility
      html = html.replace(
        /@&lt;([a-f0-9-]+)&gt;/gi,
        '<span class="mention-tag">@User</span>',
      );
    }

    // Convert URLs to clickable links using linkifyjs
    html = linkifyHtml(html, {
      target: "_blank",
      rel: "noopener noreferrer",
      className: "message-link",
    });

    return html;
  }, [content]);

  return (
    <div
      className={className}
      dangerouslySetInnerHTML={{ __html: processedContent }}
      style={
        {
          "--mention-bg": "oklch(from var(--primary) l c h / 15%)",
          "--mention-color": "var(--primary)",
        } as React.CSSProperties
      }
    />
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

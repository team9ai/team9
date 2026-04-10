/**
 * Count logical lines in message content.
 * HTML: <p> tags, <br> tags, \n inside <pre>
 * Plain text/Markdown: split by \n
 */
export function countLogicalLines(content: string): number {
  if (!content) return 0;
  const isHtml = /<(?:p|pre|br)\b/i.test(content);
  if (!isHtml) {
    return content.split('\n').length;
  }
  let lineCount = 0;
  const pMatches = content.match(/<p[\s>]/gi);
  if (pMatches) lineCount += pMatches.length;
  const brMatches = content.match(/<br\s*\/?>/gi);
  if (brMatches) lineCount += brMatches.length;
  const preRegex = /<pre[^>]*>([\s\S]*?)<\/pre>/gi;
  let match: RegExpExecArray | null;
  while ((match = preRegex.exec(content)) !== null) {
    const preContent = match[1];
    const newlineCount = (preContent.match(/\n/g) || []).length;
    lineCount += newlineCount + 1;
  }
  return Math.max(lineCount, 1);
}

// --- Truncation for preview ---

const PREVIEW_LINE_LIMIT = 20;
const PREVIEW_CHAR_LIMIT = 3000;

export interface TruncateResult {
  content: string;
  isTruncated: boolean;
  fullContentLength: number;
}

export function truncateContent(content: string): TruncateResult {
  const fullContentLength = content.length;

  if (!content) {
    return { content, isTruncated: false, fullContentLength };
  }

  const isHtml = /<(?:p|pre|br)\b/i.test(content);

  if (!isHtml) {
    // Markdown/plain text: truncate by newlines
    const lines = content.split('\n');
    if (
      lines.length <= PREVIEW_LINE_LIMIT &&
      content.length <= PREVIEW_CHAR_LIMIT
    ) {
      return { content, isTruncated: false, fullContentLength };
    }
    let truncated = lines.slice(0, PREVIEW_LINE_LIMIT).join('\n');
    if (truncated.length > PREVIEW_CHAR_LIMIT) {
      truncated = truncated.slice(0, PREVIEW_CHAR_LIMIT);
      // Try to cut at a newline boundary for cleaner output
      const lastNl = truncated.lastIndexOf('\n');
      if (lastNl > PREVIEW_CHAR_LIMIT * 0.5) {
        truncated = truncated.slice(0, lastNl);
      }
    }
    return { content: truncated, isTruncated: true, fullContentLength };
  }

  // HTML path
  const lineCount = countLogicalLines(content);
  if (lineCount <= PREVIEW_LINE_LIMIT && content.length <= PREVIEW_CHAR_LIMIT) {
    return { content, isTruncated: false, fullContentLength };
  }

  let cutPoint = content.length;

  // Check char limit
  if (content.length > PREVIEW_CHAR_LIMIT) {
    cutPoint = PREVIEW_CHAR_LIMIT;
    // Try to cut at a tag boundary
    const lastClose = content.lastIndexOf('>', cutPoint);
    if (lastClose > cutPoint * 0.5) {
      cutPoint = lastClose + 1;
    }
  }

  // Check line limit — walk through closing block elements
  if (lineCount > PREVIEW_LINE_LIMIT) {
    let lines = 0;
    const blockRegex = /<\/(p|pre|li|blockquote|h[1-6])>/gi;
    let match: RegExpExecArray | null;
    while ((match = blockRegex.exec(content)) !== null) {
      const tag = match[1].toLowerCase();
      if (tag === 'pre') {
        const preStart = content.lastIndexOf('<pre', match.index);
        const preContent = content.slice(preStart, match.index);
        lines += (preContent.match(/\n/g) || []).length + 1;
      } else {
        lines++;
      }
      if (lines >= PREVIEW_LINE_LIMIT) {
        const endPos = match.index + match[0].length;
        cutPoint = Math.min(cutPoint, endPos);
        break;
      }
    }
  }

  if (cutPoint >= content.length) {
    return { content, isTruncated: false, fullContentLength };
  }

  return {
    content: content.slice(0, cutPoint),
    isTruncated: true,
    fullContentLength,
  };
}

// --- Message type determination ---

const LONG_TEXT_LINE_THRESHOLD = 20;
const LONG_TEXT_CHAR_THRESHOLD = 2000;

export function determineMessageType(
  content: string,
  hasAttachments: boolean,
): 'text' | 'file' | 'long_text' {
  if (hasAttachments) return 'file';
  const lineCount = countLogicalLines(content);
  if (
    lineCount >= LONG_TEXT_LINE_THRESHOLD ||
    content.length >= LONG_TEXT_CHAR_THRESHOLD
  ) {
    return 'long_text';
  }
  return 'text';
}

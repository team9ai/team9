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

  // Strip <pre>...</pre> block contents before counting <p> and <br>,
  // so tags inside <pre> are not double-counted.
  const strippedContent = content.replace(
    /<pre[^>]*>[\s\S]*?<\/pre>/gi,
    '<pre></pre>',
  );

  const pMatches = strippedContent.match(/<p[\s>]/gi);
  if (pMatches) lineCount += pMatches.length;
  const brMatches = strippedContent.match(/<br\s*\/?>/gi);
  if (brMatches) lineCount += brMatches.length;

  // Count \n inside original <pre> blocks separately
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
    // Try to cut at a closing-tag boundary (search for last '</')
    // Using '</' avoids matching '>' inside <pre> code blocks (e.g. `if (a > b)`)
    const lastCloseTag = content.lastIndexOf('</', cutPoint);
    if (lastCloseTag > cutPoint * 0.5) {
      const closeEnd = content.indexOf('>', lastCloseTag);
      if (closeEnd !== -1 && closeEnd <= cutPoint + 50) {
        cutPoint = closeEnd + 1;
      }
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
    content: closeUnclosedTags(content.slice(0, cutPoint)),
    isTruncated: true,
    fullContentLength,
  };
}

/** Self-closing / void HTML elements that never need a closing tag. */
const VOID_ELEMENTS = new Set([
  'br',
  'hr',
  'img',
  'input',
  'meta',
  'link',
  'area',
  'base',
  'col',
  'embed',
  'source',
  'track',
  'wbr',
]);

/**
 * Close any unclosed HTML tags in a truncated HTML string.
 * Scans for open/close tags, maintains a stack, and appends
 * closing tags in reverse order.
 */
export function closeUnclosedTags(html: string): string {
  const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*\/?>/g;
  const stack: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(html)) !== null) {
    const fullMatch = match[0];
    const tagName = match[1].toLowerCase();

    // Skip self-closing tags (e.g. <br/>, <img ... />) and void elements
    if (fullMatch.endsWith('/>') || VOID_ELEMENTS.has(tagName)) {
      continue;
    }

    if (fullMatch.startsWith('</')) {
      // Closing tag — pop from stack if it matches
      const lastIdx = stack.lastIndexOf(tagName);
      if (lastIdx !== -1) {
        stack.splice(lastIdx, 1);
      }
    } else {
      // Opening tag
      stack.push(tagName);
    }
  }

  // Close remaining open tags in reverse order
  let result = html;
  for (let i = stack.length - 1; i >= 0; i--) {
    result += `</${stack[i]}>`;
  }
  return result;
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

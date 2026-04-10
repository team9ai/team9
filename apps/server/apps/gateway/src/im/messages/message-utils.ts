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

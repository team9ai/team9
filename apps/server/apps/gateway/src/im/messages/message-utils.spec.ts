import { describe, expect, it } from '@jest/globals';
import {
  closeUnclosedTags,
  countLogicalLines,
  determineMessageType,
  truncateContent,
} from './message-utils.js';

describe('countLogicalLines', () => {
  it('returns 0 for empty string', () => {
    expect(countLogicalLines('')).toBe(0);
  });

  it('returns 0 for null/undefined-ish input', () => {
    expect(countLogicalLines(null as unknown as string)).toBe(0);
    expect(countLogicalLines(undefined as unknown as string)).toBe(0);
  });

  it('returns 1 for single-line plain text', () => {
    expect(countLogicalLines('hello world')).toBe(1);
  });

  it('counts newlines in plain text / markdown', () => {
    expect(countLogicalLines('line1\nline2\nline3')).toBe(3);
  });

  it('counts a single trailing newline as an extra line', () => {
    expect(countLogicalLines('line1\n')).toBe(2);
  });

  // HTML: <p> tags
  it('counts <p> tags as lines in HTML', () => {
    const html = '<p>first</p><p>second</p><p>third</p>';
    expect(countLogicalLines(html)).toBe(3);
  });

  it('counts <p> with attributes', () => {
    const html = '<p class="foo">first</p><p style="color:red">second</p>';
    expect(countLogicalLines(html)).toBe(2);
  });

  // HTML: <br> tags
  it('counts <br> tags as lines', () => {
    const html = '<p>line1<br>line2<br/>line3<br />line4</p>';
    // 1 <p> + 3 <br> variants = 4
    expect(countLogicalLines(html)).toBe(4);
  });

  // HTML: <pre> blocks
  it('counts newlines inside <pre> blocks', () => {
    const html = '<pre>line1\nline2\nline3</pre>';
    // 2 newlines + 1 = 3 lines for <pre>
    expect(countLogicalLines(html)).toBe(3);
  });

  it('counts <pre> with attributes', () => {
    const html = '<pre class="code">a\nb\nc\nd</pre>';
    // 3 newlines + 1 = 4
    expect(countLogicalLines(html)).toBe(4);
  });

  it('combines <p>, <br>, and <pre> counts', () => {
    const html = '<p>intro</p><p>body<br>more</p><pre>code\nhere</pre>';
    // 2 <p> + 1 <br> + (1 newline + 1) = 2 + 1 + 2 = 5
    expect(countLogicalLines(html)).toBe(5);
  });

  it('returns at least 1 for HTML with no recognized block elements', () => {
    // Contains <br but doesn't match typical patterns - still triggers HTML path
    // Actually this won't trigger HTML since there's no <p, <pre, or <br
    const html = '<span>just inline</span>';
    // No <p>, <br>, <pre> → not detected as HTML → split by \n → 1 line
    expect(countLogicalLines(html)).toBe(1);
  });

  it('handles case-insensitive HTML tags', () => {
    const html = '<P>first</P><BR><PRE>code\nhere</PRE>';
    // 1 <P> + 1 <BR> + (1 newline + 1) = 1 + 1 + 2 = 4
    expect(countLogicalLines(html)).toBe(4);
  });

  it('handles multiple <pre> blocks', () => {
    const html = '<pre>a\nb</pre><pre>c\nd\ne</pre>';
    // first pre: 1 newline + 1 = 2; second pre: 2 newlines + 1 = 3; total = 5
    expect(countLogicalLines(html)).toBe(5);
  });

  it('returns at least 1 for HTML with only empty tags', () => {
    // Triggers HTML detection but no matches
    const html = '<pre></pre>';
    // pre content is empty: 0 newlines + 1 = 1
    expect(countLogicalLines(html)).toBe(1);
  });

  it('does not double-count <p> tags inside <pre> blocks', () => {
    // <pre> contains <p> tags — they should only be counted as \n lines, not as <p> lines
    const html = '<p>intro</p><pre><p>code paragraph</p>\nline2</pre>';
    // Outside pre: 1 <p> = 1
    // Inside pre: 1 \n + 1 = 2
    // Total = 3 (NOT 4 — the <p> inside <pre> must not be counted twice)
    expect(countLogicalLines(html)).toBe(3);
  });

  it('does not double-count <br> tags inside <pre> blocks', () => {
    const html = '<pre>line1<br>line2\nline3</pre>';
    // Inside pre: 1 \n + 1 = 2; <br> inside pre should NOT add extra
    expect(countLogicalLines(html)).toBe(2);
  });
});

describe('determineMessageType', () => {
  it('returns "file" when hasAttachments is true', () => {
    expect(determineMessageType('short', true)).toBe('file');
  });

  it('returns "file" even for long content when hasAttachments is true', () => {
    const longContent = 'a'.repeat(3000);
    expect(determineMessageType(longContent, true)).toBe('file');
  });

  it('returns "text" for short content without attachments', () => {
    expect(determineMessageType('hello', false)).toBe('text');
  });

  it('returns "long_text" when content >= 2000 chars', () => {
    const content = 'a'.repeat(2000);
    expect(determineMessageType(content, false)).toBe('long_text');
  });

  it('returns "text" when content is just under 2000 chars', () => {
    const content = 'a'.repeat(1999);
    expect(determineMessageType(content, false)).toBe('text');
  });

  it('returns "long_text" when content has >= 20 logical lines', () => {
    const content = Array.from({ length: 20 }, (_, i) => `line ${i}`).join(
      '\n',
    );
    expect(determineMessageType(content, false)).toBe('long_text');
  });

  it('returns "text" when content has 19 logical lines', () => {
    const content = Array.from({ length: 19 }, (_, i) => `line ${i}`).join(
      '\n',
    );
    // 19 lines → split produces 19 elements
    expect(determineMessageType(content, false)).toBe('text');
  });

  it('returns "long_text" for HTML with >= 20 <p> tags', () => {
    const html = Array.from({ length: 20 }, (_, i) => `<p>line ${i}</p>`).join(
      '',
    );
    expect(determineMessageType(html, false)).toBe('long_text');
  });

  it('returns "long_text" when char threshold met but line threshold not', () => {
    // Single very long line
    const content = 'x'.repeat(2500);
    expect(determineMessageType(content, false)).toBe('long_text');
  });

  it('returns "long_text" when line threshold met but char threshold not', () => {
    // Many short lines
    const content = Array.from({ length: 25 }, () => 'hi').join('\n');
    expect(determineMessageType(content, false)).toBe('long_text');
  });
});

describe('truncateContent', () => {
  it('returns content unchanged when under both limits', () => {
    const content = 'short message';
    const result = truncateContent(content);
    expect(result).toEqual({
      content: 'short message',
      isTruncated: false,
      fullContentLength: content.length,
    });
  });

  it('returns empty string unchanged', () => {
    const result = truncateContent('');
    expect(result).toEqual({
      content: '',
      isTruncated: false,
      fullContentLength: 0,
    });
  });

  it('handles null input without throwing', () => {
    const result = truncateContent(null as unknown as string);
    expect(result).toEqual({
      content: '',
      isTruncated: false,
      fullContentLength: 0,
    });
  });

  it('handles undefined input without throwing', () => {
    const result = truncateContent(undefined as unknown as string);
    expect(result).toEqual({
      content: '',
      isTruncated: false,
      fullContentLength: 0,
    });
  });

  // --- Markdown/plain text ---

  it('truncates markdown content exceeding 20 lines', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`);
    const content = lines.join('\n');
    const result = truncateContent(content);
    expect(result.isTruncated).toBe(true);
    expect(result.fullContentLength).toBe(content.length);
    // Should contain only the first 20 lines
    const truncatedLines = result.content.split('\n');
    expect(truncatedLines.length).toBe(20);
    expect(truncatedLines[0]).toBe('line 0');
    expect(truncatedLines[19]).toBe('line 19');
  });

  it('truncates markdown content exceeding 3000 chars even if under 20 lines', () => {
    // 10 lines, each 400 chars = 4000 chars + 9 newlines
    const lines = Array.from(
      { length: 10 },
      (_, i) => `L${i}:${'x'.repeat(398)}`,
    );
    const content = lines.join('\n');
    expect(content.length).toBeGreaterThan(3000);
    const result = truncateContent(content);
    expect(result.isTruncated).toBe(true);
    expect(result.content.length).toBeLessThanOrEqual(3000);
    expect(result.fullContentLength).toBe(content.length);
  });

  it('does not truncate markdown with exactly 20 lines under char limit', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i}`);
    const content = lines.join('\n');
    expect(content.length).toBeLessThan(3000);
    const result = truncateContent(content);
    expect(result.isTruncated).toBe(false);
    expect(result.content).toBe(content);
  });

  it('truncates markdown at char limit and tries newline boundary', () => {
    // Create content with lines that are ~200 chars each, 19 lines, but exceeding 3000 chars
    const lines = Array.from(
      { length: 19 },
      (_, i) => `L${i}:${'a'.repeat(198)}`,
    );
    const content = lines.join('\n');
    // 19 lines * 200 chars + 18 newlines = 3818 chars
    expect(content.length).toBeGreaterThan(3000);
    const result = truncateContent(content);
    expect(result.isTruncated).toBe(true);
    // Should cut at a newline boundary since we have lines within the 50% range
    expect(
      result.content.endsWith('\n') ||
        !result.content.includes('\n') ||
        result.content.split('\n').length < 19,
    ).toBe(true);
  });

  // --- HTML ---

  it('does not truncate HTML under both limits', () => {
    const html = '<p>hello</p><p>world</p>';
    const result = truncateContent(html);
    expect(result.isTruncated).toBe(false);
    expect(result.content).toBe(html);
  });

  it('truncates HTML content exceeding 20 logical lines', () => {
    // 25 <p> tags
    const html = Array.from({ length: 25 }, (_, i) => `<p>line ${i}</p>`).join(
      '',
    );
    const result = truncateContent(html);
    expect(result.isTruncated).toBe(true);
    expect(result.fullContentLength).toBe(html.length);
    // Truncated content should be shorter than original
    expect(result.content.length).toBeLessThan(html.length);
  });

  it('truncates HTML content exceeding 3000 chars', () => {
    // 10 <p> tags with long content
    const html = Array.from(
      { length: 10 },
      (_, i) => `<p>${'x'.repeat(400)} line ${i}</p>`,
    ).join('');
    expect(html.length).toBeGreaterThan(3000);
    const result = truncateContent(html);
    expect(result.isTruncated).toBe(true);
    expect(result.content.length).toBeLessThan(html.length);
  });

  it('counts pre block lines correctly when truncating HTML', () => {
    // pre block with 18 lines + 5 <p> tags = 23 logical lines
    const preLines = Array.from({ length: 17 }, (_, i) => `code ${i}`).join(
      '\n',
    );
    const html =
      `<pre>${preLines}</pre>` +
      Array.from({ length: 5 }, (_, i) => `<p>para ${i}</p>`).join('');
    const result = truncateContent(html);
    expect(result.isTruncated).toBe(true);
    expect(result.fullContentLength).toBe(html.length);
  });

  it('handles HTML with both char and line limits exceeded', () => {
    // Many long paragraphs
    const html = Array.from(
      { length: 30 },
      (_, i) => `<p>${'y'.repeat(200)} paragraph ${i}</p>`,
    ).join('');
    const result = truncateContent(html);
    expect(result.isTruncated).toBe(true);
    // Should be truncated by whichever limit is hit first
    expect(result.content.length).toBeLessThan(html.length);
  });

  it('returns fullContentLength equal to original length', () => {
    const content = 'a'.repeat(5000);
    const result = truncateContent(content);
    expect(result.fullContentLength).toBe(5000);
  });

  it('does not truncate short non-long_text-like content', () => {
    const content = 'Hello, world!';
    const result = truncateContent(content);
    expect(result.isTruncated).toBe(false);
    expect(result.content).toBe(content);
    expect(result.fullContentLength).toBe(content.length);
  });

  it('closes unclosed tags after HTML truncation by line limit', () => {
    const html = Array.from({ length: 25 }, (_, i) => `<p>line ${i}</p>`).join(
      '',
    );
    const result = truncateContent(html);
    expect(result.isTruncated).toBe(true);
    const openCount = (result.content.match(/<p[\s>]/gi) || []).length;
    const closeCount = (result.content.match(/<\/p>/gi) || []).length;
    expect(openCount).toBe(closeCount);
  });

  it('closes deeply nested unclosed tags after char-limit truncation', () => {
    // 3100 chars inside ensures we exceed the 3000 char limit
    const longInner = 'x'.repeat(3100);
    const html = `<div><p><strong>${longInner}</strong></p></div><p>more</p>`;
    const result = truncateContent(html);
    expect(result.isTruncated).toBe(true);
    // The slice cuts mid-nesting; closeUnclosedTags should close all open tags
    expect(result.content).toMatch(/<\/strong><\/p><\/div>$/);
  });
});

describe('closeUnclosedTags', () => {
  it('returns unchanged HTML when all tags are closed', () => {
    expect(closeUnclosedTags('<p>hello</p>')).toBe('<p>hello</p>');
  });

  it('closes a single unclosed tag', () => {
    expect(closeUnclosedTags('<p>hello')).toBe('<p>hello</p>');
  });

  it('closes multiple unclosed tags in reverse order', () => {
    expect(closeUnclosedTags('<div><p>hello')).toBe('<div><p>hello</p></div>');
  });

  it('ignores self-closing tags', () => {
    expect(closeUnclosedTags('<p>hello<br/>world')).toBe(
      '<p>hello<br/>world</p>',
    );
  });

  it('ignores void elements like <br>', () => {
    expect(closeUnclosedTags('<p>hello<br>world')).toBe(
      '<p>hello<br>world</p>',
    );
  });

  it('handles already-closed nested tags', () => {
    expect(closeUnclosedTags('<div><p>text</p>')).toBe(
      '<div><p>text</p></div>',
    );
  });

  it('returns empty string unchanged', () => {
    expect(closeUnclosedTags('')).toBe('');
  });

  it('handles tags with attributes', () => {
    expect(closeUnclosedTags('<div class="foo"><p id="bar">text')).toBe(
      '<div class="foo"><p id="bar">text</p></div>',
    );
  });
});

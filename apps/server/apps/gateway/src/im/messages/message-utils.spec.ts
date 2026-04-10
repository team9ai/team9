import { describe, expect, it } from '@jest/globals';
import { countLogicalLines, determineMessageType } from './message-utils.js';

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

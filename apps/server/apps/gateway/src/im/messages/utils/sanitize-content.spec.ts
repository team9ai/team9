import { sanitizeMessageContent } from './sanitize-content.js';

describe('sanitizeMessageContent', () => {
  it('strips <script> tags', () => {
    const input = '<p>hi</p><script>alert(1)</script>';
    expect(sanitizeMessageContent(input)).toBe('<p>hi</p>');
  });

  it('strips inline event handlers', () => {
    const input = '<p onclick="alert(1)">hi</p>';
    const out = sanitizeMessageContent(input);
    expect(out).not.toContain('onclick');
    expect(out).toContain('hi');
  });

  it('strips javascript: URLs from <a href>', () => {
    const input = '<a href="javascript:alert(1)">click</a>';
    const out = sanitizeMessageContent(input);
    expect(out).not.toContain('javascript:');
  });

  it('neutralizes <img onerror>', () => {
    const input = '<p>x</p><img src="x" onerror="alert(1)">';
    const out = sanitizeMessageContent(input);
    expect(out).not.toContain('onerror');
  });

  it('strips <iframe>', () => {
    const out = sanitizeMessageContent('<iframe src="https://evil"></iframe>');
    expect(out).not.toContain('<iframe');
  });

  it('keeps formatting, mentions, and code blocks intact', () => {
    const input =
      '<p><strong>bold</strong> <em>em</em> <span class="mention-tag" data-mention-user-id="u1">@Alice</span></p><pre><code class="language-ts">const x = 1;</code></pre>';
    const out = sanitizeMessageContent(input);
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toContain('<em>em</em>');
    expect(out).toContain('data-mention-user-id="u1"');
    expect(out).toContain('class="language-ts"');
    expect(out).toContain('const x = 1;');
  });

  it('keeps safe http(s) links with rel/target', () => {
    const input =
      '<a href="https://example.com" target="_blank" rel="noopener noreferrer">ok</a>';
    const out = sanitizeMessageContent(input);
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('target="_blank"');
  });
});

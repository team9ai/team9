import DOMPurify from "dompurify";

// Sanitize Lexical / code-highlight / math / linkified HTML before rendering
// with dangerouslySetInnerHTML. Strips scripts, event handlers, javascript:
// URLs, style attributes and form elements, while preserving formatting,
// mentions (data-* attrs), links, code-highlight spans, and KaTeX MathML.
//
// USE_PROFILES.html+mathMl expands to DOMPurify's built-in safe tag/attr
// allow-list, which already covers every tag our renderers emit. data-* and
// aria-* attributes are kept by default (ALLOW_DATA_ATTR / ALLOW_ARIA_ATTR),
// which is what the mention click/hover handlers rely on.
export function sanitizeMessageHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, mathMl: true },
    // Keep `target` on anchors so legacy messages still open links in a new
    // tab. DOMPurify auto-injects `rel="noopener noreferrer"` whenever
    // target is present, so this does not reintroduce tabnabbing.
    ADD_ATTR: ["target"],
    FORBID_TAGS: ["form", "input", "textarea", "select", "option"],
    FORBID_ATTR: ["style"],
  });
}

// Sanitize PostgreSQL ts_headline output. Only <mark> is legal; anything else
// (including any HTML that leaked into the message) must render as text.
export function sanitizeSearchHighlight(
  html: string | undefined | null,
): string {
  if (!html) return "";
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ["mark"],
    ALLOWED_ATTR: [],
  });
}

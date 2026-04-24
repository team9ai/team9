import sanitizeHtml from 'sanitize-html';

const MATHML_TAGS = [
  'math',
  'mi',
  'mo',
  'mn',
  'ms',
  'mtext',
  'mspace',
  'mrow',
  'mfrac',
  'msqrt',
  'mroot',
  'msub',
  'msup',
  'msubsup',
  'munder',
  'mover',
  'munderover',
  'mtable',
  'mtr',
  'mtd',
  'mstyle',
  'mpadded',
  'menclose',
  'semantics',
  'annotation',
  'annotation-xml',
  'merror',
  'mphantom',
  'mlabeledtr',
];

const ALLOWED_TAGS = [
  ...sanitizeHtml.defaults.allowedTags,
  'img',
  'mark',
  'u',
  's',
  'sub',
  'sup',
  'button',
  'span',
  ...MATHML_TAGS,
];

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: {
    '*': [
      'class',
      'aria-hidden',
      'data-code',
      'data-mention-user-id',
      'data-mention-display-name',
    ],
    a: ['href', 'target', 'rel', 'class'],
    img: ['src', 'alt', 'title', 'class'],
    button: ['type', 'class', 'data-code'],
    code: ['class'],
    pre: ['class'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesAppliedToAttributes: ['href', 'src'],
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
};

// Server-side defense-in-depth against XSS in message content. Runs at every
// write path (REST create/update, bot sendFromBot) so that even if a client
// bypasses the Lexical editor and posts raw HTML, the persisted payload no
// longer contains <script>, event handlers, javascript:/data: URLs, or form
// controls. The client still sanitizes on render — this is the second line.
export function sanitizeMessageContent(content: string): string {
  return sanitizeHtml(content, OPTIONS);
}

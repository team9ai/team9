import type { RequestHandler } from 'express';
import helmet from 'helmet';

// Centralized Content Security Policy.
//
// Split between an enforced CSP (hard-block network sinks attacker code would
// need) and a report-only CSP carrying `require-trusted-types-for 'script'`.
// Trusted Types stays report-only until DevTools/Sentry confirm zero
// violations for a release cycle; flip `enforceTrustedTypes()` to promote.

export const CSP_DIRECTIVES = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'script-src-attr': ["'none'"],
  // Tailwind + KaTeX ship inline styles; `'unsafe-inline'` on style-src is
  // unavoidable until we add style hashes. CSS cannot execute JS so the
  // remaining impact is limited to layout/ui fraud.
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:', 'blob:', 'https:'],
  'font-src': ["'self'", 'data:'],
  'connect-src': ["'self'", 'https:', 'wss:', 'ws:'],
  'frame-src': ["'self'"],
  'frame-ancestors': ["'none'"],
  'object-src': ["'none'"],
  'base-uri': ["'none'"],
  'form-action': ["'self'"],
} as const;

export const TRUSTED_TYPES_REPORT_ONLY_HEADER =
  "require-trusted-types-for 'script'; trusted-types team9-sanitized default";

/**
 * Helmet middleware preconfigured with CSP_DIRECTIVES. Use in main.ts.
 */
export function securityHeadersMiddleware() {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: CSP_DIRECTIVES as unknown as Record<string, string[]>,
    },
    crossOriginEmbedderPolicy: false, // Socket.io / Sentry need cross-origin assets
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });
}

/**
 * Tiny middleware that advertises the report-only Trusted Types policy. Kept
 * separate from helmet because we don't want the whole CSP in report-only
 * mode — only the TT directives need the gentler rollout.
 */
export const trustedTypesReportOnlyMiddleware: RequestHandler = (
  _req,
  res,
  next,
) => {
  res.setHeader(
    'Content-Security-Policy-Report-Only',
    TRUSTED_TYPES_REPORT_ONLY_HEADER,
  );
  next();
};

// Trusted Types bootstrap. Registers a named policy "team9-sanitized" and a
// "default" fallback policy so that when the server advertises
// `require-trusted-types-for 'script'` (report-only today, enforced later)
// every DOM innerHTML sink either:
//   1. receives a TrustedHTML produced by our sanitizer, or
//   2. falls through the default policy, which sanitizes + reports.
//
// This file MUST be imported before any component that touches the DOM — see
// main.tsx where it is the first non-side-effect import.
import DOMPurify from "dompurify";

// Narrow typing: TS stdlib doesn't ship TrustedTypes types by default.
interface TrustedTypePolicy {
  createHTML(input: string): string;
}
interface TrustedTypePolicyFactory {
  createPolicy(
    name: string,
    policy: { createHTML: (input: string) => string },
  ): TrustedTypePolicy;
}
declare global {
  interface Window {
    trustedTypes?: TrustedTypePolicyFactory;
  }
}

function sanitize(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, mathMl: true },
    FORBID_TAGS: ["form", "input", "textarea", "select", "option"],
    FORBID_ATTR: ["style"],
  });
}

function reportViolation(raw: string): void {
  // We're in report-only — log locally and let Sentry's
  // SecurityPolicyViolationEvent handler catch the CSP report. We keep the
  // offending payload length bounded so misbehaving callers can't flood logs.
  const preview = raw.length > 200 ? raw.slice(0, 200) + "…" : raw;
  console.warn(
    "[trusted-types] innerHTML sink bypassed named policy; " +
      "default policy sanitized it. Offending HTML (truncated):",
    preview,
  );
}

if (typeof window !== "undefined" && window.trustedTypes) {
  try {
    window.trustedTypes.createPolicy("team9-sanitized", {
      createHTML: (input) => sanitize(input),
    });
  } catch (err) {
    console.warn("[trusted-types] failed to create named policy:", err);
  }
  try {
    window.trustedTypes.createPolicy("default", {
      createHTML: (input) => {
        reportViolation(input);
        return sanitize(input);
      },
    });
  } catch (err) {
    // A "default" policy may already be registered by another library (e.g.
    // React dev tooling). Swallow — our named policy is still active.
    console.warn("[trusted-types] default policy registration skipped:", err);
  }
}

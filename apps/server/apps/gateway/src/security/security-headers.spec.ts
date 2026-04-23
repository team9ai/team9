import express from 'express';
import request from 'supertest';
import {
  CSP_DIRECTIVES,
  TRUSTED_TYPES_REPORT_ONLY_HEADER,
  securityHeadersMiddleware,
  trustedTypesReportOnlyMiddleware,
} from './security-headers.js';

// These tests pin the CSP we ship. A future dev loosening any directive
// (e.g. adding `'unsafe-inline'` to script-src) must update this file and
// explicitly own that change in the PR.

describe('CSP_DIRECTIVES', () => {
  it("pins script-src to 'self' only — no inline, no eval, no wildcards", () => {
    expect(CSP_DIRECTIVES['script-src']).toEqual(["'self'"]);
  });

  it("bans inline event handlers via script-src-attr 'none'", () => {
    expect(CSP_DIRECTIVES['script-src-attr']).toEqual(["'none'"]);
  });

  it('forbids object/embed/applet', () => {
    expect(CSP_DIRECTIVES['object-src']).toEqual(["'none'"]);
  });

  it('blocks framing (clickjacking defense)', () => {
    expect(CSP_DIRECTIVES['frame-ancestors']).toEqual(["'none'"]);
  });

  it('prevents <base> hijacking', () => {
    expect(CSP_DIRECTIVES['base-uri']).toEqual(["'none'"]);
  });

  it('restricts form-action to same origin', () => {
    expect(CSP_DIRECTIVES['form-action']).toEqual(["'self'"]);
  });
});

describe('security headers middleware (end-to-end)', () => {
  const app = express();
  app.use(securityHeadersMiddleware());
  app.use(trustedTypesReportOnlyMiddleware);
  app.get('/ping', (_req, res) => {
    res.json({ ok: true });
  });

  it('emits Content-Security-Policy with our pinned directives', async () => {
    const res = await request(app).get('/ping');
    expect(res.status).toBe(200);
    const csp = res.headers['content-security-policy'];
    expect(csp).toBeDefined();
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'none'");
  });

  it('emits the Trusted Types report-only header naming our named policy', async () => {
    const res = await request(app).get('/ping');
    expect(res.headers['content-security-policy-report-only']).toBe(
      TRUSTED_TYPES_REPORT_ONLY_HEADER,
    );
    expect(res.headers['content-security-policy-report-only']).toContain(
      'team9-sanitized',
    );
    expect(res.headers['content-security-policy-report-only']).toContain(
      "require-trusted-types-for 'script'",
    );
  });

  it('sets X-Frame-Options (helmet default) in addition to frame-ancestors', async () => {
    const res = await request(app).get('/ping');
    expect(res.headers['x-frame-options']).toBeDefined();
  });
});

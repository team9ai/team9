import { describe, it, expect } from '@jest/globals';

import {
  MIN_BODY_CHARS,
  validateSkillMd,
  type ValidationFailureRule,
} from '../validate-skill-md.js';

// ── fixtures ─────────────────────────────────────────────────────────

const EXPECTED_NAME = 'routine-7f3a2b1c-1111';
const EXPECTED_DESC = 'Send the daily standup at 9am';

/**
 * Compose a SKILL.md from frontmatter + body fragments so individual
 * tests can mutate one piece at a time without re-typing the full layout.
 */
function compose(args: {
  name?: string;
  description?: string;
  /** Override the entire frontmatter block (skips name/description). */
  rawFrontmatter?: string;
  body?: string;
  /** Use Windows line endings throughout. */
  crlf?: boolean;
  /** Omit the trailing fence (malformed). */
  omitClosingFence?: boolean;
  /** Omit the opening fence (malformed). */
  omitOpeningFence?: boolean;
}): string {
  const nl = args.crlf ? '\r\n' : '\n';
  const fm =
    args.rawFrontmatter !== undefined
      ? args.rawFrontmatter
      : [
          `name: ${args.name ?? EXPECTED_NAME}`,
          `description: ${args.description ?? EXPECTED_DESC}`,
        ].join(nl);
  const body =
    args.body ?? 'A non-trivial body that easily clears the threshold.';

  const parts: string[] = [];
  if (!args.omitOpeningFence) {
    parts.push('---');
  }
  parts.push(fm);
  if (!args.omitClosingFence) {
    parts.push('---');
  }
  parts.push('');
  parts.push(body);
  return parts.join(nl);
}

// ── tests ────────────────────────────────────────────────────────────

describe('validateSkillMd', () => {
  describe('happy path', () => {
    it('returns ok:true when name + description + body all match', () => {
      const md = compose({});
      expect(validateSkillMd(md, EXPECTED_NAME, EXPECTED_DESC)).toEqual({
        ok: true,
      });
    });

    it('accepts CRLF line endings', () => {
      const md = compose({ crlf: true });
      expect(validateSkillMd(md, EXPECTED_NAME, EXPECTED_DESC)).toEqual({
        ok: true,
      });
    });

    it('accepts a description with a trailing newline (forgiving trim)', () => {
      // The routine record could carry a trailing newline; the agent's
      // SKILL.md frontmatter reflects the canonical (trimmed) value.
      // Validation should accept this.
      const md = compose({ description: EXPECTED_DESC });
      expect(validateSkillMd(md, EXPECTED_NAME, `${EXPECTED_DESC}\n`)).toEqual({
        ok: true,
      });
    });

    it('accepts a body with exactly MIN_BODY_CHARS after trim', () => {
      const body = 'x'.repeat(MIN_BODY_CHARS);
      const md = compose({ body });
      expect(validateSkillMd(md, EXPECTED_NAME, EXPECTED_DESC)).toEqual({
        ok: true,
      });
    });

    it('accepts a body with leading/trailing whitespace as long as trimmed length ≥ 20', () => {
      const body = `   \n${'a'.repeat(MIN_BODY_CHARS)}\n  \r\n  `;
      const md = compose({ body });
      expect(validateSkillMd(md, EXPECTED_NAME, EXPECTED_DESC)).toEqual({
        ok: true,
      });
    });
  });

  describe('frontmatter structure', () => {
    it('rejects empty content with reason mentioning empty/missing', () => {
      const result = validateSkillMd('', EXPECTED_NAME, EXPECTED_DESC);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason.toLowerCase()).toContain('empty');
      }
    });

    it('rejects non-string content with reason mentioning empty/missing', () => {
      // Defensive: callers should always pass strings, but some upstream
      // adapters might forward an unparsed buffer / null. Make sure we
      // reject cleanly rather than throwing.
      const result = validateSkillMd(
        undefined as unknown as string,
        EXPECTED_NAME,
        EXPECTED_DESC,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason.toLowerCase()).toContain('empty');
      }
    });

    it('rejects content missing the opening fence', () => {
      const md = compose({ omitOpeningFence: true });
      const result = validateSkillMd(md, EXPECTED_NAME, EXPECTED_DESC);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason.toLowerCase()).toContain('frontmatter');
      }
    });

    it('rejects content missing the closing fence', () => {
      const md = compose({ omitClosingFence: true });
      const result = validateSkillMd(md, EXPECTED_NAME, EXPECTED_DESC);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason.toLowerCase()).toContain('frontmatter');
      }
    });

    it('rejects YAML parse error with reason mentioning frontmatter parse', () => {
      // YAML rejects bare unquoted `:` followed by additional `:` on the
      // same key, especially when the value is a multi-line block-scalar
      // marker like `|` with mismatched indent. Easier path: an unbalanced
      // bracket forces parse failure cleanly.
      const md = compose({
        rawFrontmatter: 'name: [unclosed\ndescription: x',
      });
      const result = validateSkillMd(md, EXPECTED_NAME, EXPECTED_DESC);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason.toLowerCase()).toContain('frontmatter parse');
      }
    });

    it('rejects scalar (non-object) frontmatter with descriptive reason', () => {
      // Rare but possible if the agent writes a single value: YAML parses
      // "just-a-string" as a scalar string, not an object.
      const md = compose({ rawFrontmatter: 'just-a-string' });
      const result = validateSkillMd(md, EXPECTED_NAME, EXPECTED_DESC);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason.toLowerCase()).toContain('yaml object');
      }
    });

    it('rejects array frontmatter with descriptive reason', () => {
      const md = compose({ rawFrontmatter: '- foo\n- bar' });
      const result = validateSkillMd(md, EXPECTED_NAME, EXPECTED_DESC);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason.toLowerCase()).toContain('yaml object');
      }
    });
  });

  describe('name field', () => {
    it('rejects missing name field', () => {
      const md = compose({
        rawFrontmatter: `description: ${EXPECTED_DESC}`,
      });
      const result = validateSkillMd(md, EXPECTED_NAME, EXPECTED_DESC);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason.toLowerCase()).toContain('name');
      }
    });

    it('rejects non-string name (e.g. numeric)', () => {
      const md = compose({
        rawFrontmatter: `name: 42\ndescription: ${EXPECTED_DESC}`,
      });
      const result = validateSkillMd(md, EXPECTED_NAME, EXPECTED_DESC);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason.toLowerCase()).toContain('name');
        expect(result.reason).toContain('string');
      }
    });

    it('rejects mismatched name with reason mentioning expected value', () => {
      const md = compose({ name: 'routine-wrong-id' });
      const result = validateSkillMd(md, EXPECTED_NAME, EXPECTED_DESC);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain(EXPECTED_NAME);
        expect(result.reason).toContain('routine-wrong-id');
      }
    });
  });

  describe('description field', () => {
    it('rejects missing description', () => {
      const md = compose({
        rawFrontmatter: `name: ${EXPECTED_NAME}`,
      });
      const result = validateSkillMd(md, EXPECTED_NAME, EXPECTED_DESC);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason.toLowerCase()).toContain('description');
      }
    });

    it('rejects non-string description', () => {
      const md = compose({
        rawFrontmatter: `name: ${EXPECTED_NAME}\ndescription: 123`,
      });
      const result = validateSkillMd(md, EXPECTED_NAME, EXPECTED_DESC);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason.toLowerCase()).toContain('description');
        expect(result.reason).toContain('string');
      }
    });

    it('rejects empty description (whitespace only)', () => {
      const md = compose({
        rawFrontmatter: `name: ${EXPECTED_NAME}\ndescription: "   "`,
      });
      const result = validateSkillMd(md, EXPECTED_NAME, EXPECTED_DESC);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason.toLowerCase()).toContain('description');
        expect(result.reason.toLowerCase()).toContain('non-empty');
      }
    });

    it('rejects description that does not match routine.description', () => {
      const md = compose({ description: 'a different description' });
      const result = validateSkillMd(md, EXPECTED_NAME, EXPECTED_DESC);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason.toLowerCase()).toContain('description');
        expect(result.reason.toLowerCase()).toContain('match');
      }
    });
  });

  describe('body length', () => {
    it('rejects empty body with reason mentioning body', () => {
      const md = compose({ body: '' });
      const result = validateSkillMd(md, EXPECTED_NAME, EXPECTED_DESC);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason.toLowerCase()).toContain('body');
      }
    });

    it('rejects whitespace-only body (newlines + spaces) with body reason', () => {
      const md = compose({ body: '   \n\t  \r\n  ' });
      const result = validateSkillMd(md, EXPECTED_NAME, EXPECTED_DESC);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason.toLowerCase()).toContain('body');
      }
    });

    it('rejects body shorter than MIN_BODY_CHARS after trim', () => {
      const md = compose({ body: 'too short' });
      const result = validateSkillMd(md, EXPECTED_NAME, EXPECTED_DESC);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason.toLowerCase()).toContain('body');
        expect(result.reason).toContain(String(MIN_BODY_CHARS));
      }
    });
  });

  // ── A.11 — rule discriminator (metric label source) ───────────────
  //
  // Each failure path returns a stable `rule` code so the
  // `routines_complete_creation_validation_failure_total{rule}` counter
  // sees a closed-set label space. The test below pins one fixture per
  // rule so a future maintainer can't accidentally rename a rule string
  // without updating dashboards/alerts.

  describe('rule discriminator', () => {
    const cases: Array<{ rule: ValidationFailureRule; build: () => string }> = [
      { rule: 'empty', build: () => '' },
      { rule: 'frontmatter_missing', build: () => 'just a body, no fences' },
      {
        rule: 'frontmatter_parse',
        build: () =>
          compose({ rawFrontmatter: 'name: [unclosed\ndescription: x' }),
      },
      {
        rule: 'frontmatter_not_object',
        build: () => compose({ rawFrontmatter: 'just-a-string' }),
      },
      {
        rule: 'name_invalid',
        build: () =>
          compose({
            rawFrontmatter: `name: 42\ndescription: ${EXPECTED_DESC}`,
          }),
      },
      {
        rule: 'name_mismatch',
        build: () => compose({ name: 'routine-wrong-id' }),
      },
      {
        rule: 'description_invalid',
        build: () =>
          compose({
            rawFrontmatter: `name: ${EXPECTED_NAME}\ndescription: 42`,
          }),
      },
      {
        rule: 'description_empty',
        build: () =>
          compose({
            rawFrontmatter: `name: ${EXPECTED_NAME}\ndescription: "   "`,
          }),
      },
      {
        rule: 'description_mismatch',
        build: () => compose({ description: 'totally different' }),
      },
      { rule: 'body_empty', build: () => compose({ body: '   \n  ' }) },
      { rule: 'body_too_short', build: () => compose({ body: 'short' }) },
    ];

    for (const { rule, build } of cases) {
      it(`returns rule="${rule}" on the matching failure`, () => {
        const result = validateSkillMd(build(), EXPECTED_NAME, EXPECTED_DESC);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.rule).toBe(rule);
        }
      });
    }

    it('happy path does not have a `rule` field (ok:true is exhaustive)', () => {
      const result = validateSkillMd(compose({}), EXPECTED_NAME, EXPECTED_DESC);
      expect(result).toEqual({ ok: true });
    });
  });
});

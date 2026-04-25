import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseFrontmatter,
  serializeFrontmatter,
  FrontmatterParseError,
  type ParsedPage,
} from '../utils/frontmatter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Test file: apps/server/apps/gateway/src/wikis/__tests__/frontmatter.spec.ts
// Fixtures: apps/server/libs/shared/test-fixtures/wiki-frontmatter/
// 5 levels up from __tests__ to reach apps/server, then down into libs/shared.
const FIXTURE_DIR = join(
  __dirname,
  '../../../../../libs/shared/test-fixtures/wiki-frontmatter',
);

type FixtureExpectation = {
  frontmatter: Record<string, unknown>;
  body: string;
};

const EXPECTED = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'fixtures.json'), 'utf8'),
) as Record<string, FixtureExpectation>;

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURE_DIR, name), 'utf8');
}

describe('frontmatter util', () => {
  describe('fixtures', () => {
    for (const [file, expected] of Object.entries(EXPECTED)) {
      it(`parses ${file}`, () => {
        const result = parseFrontmatter(loadFixture(file));
        expect(result.frontmatter).toEqual(expected.frontmatter);
        expect(result.body).toBe(expected.body);
      });

      it(`round-trips ${file}`, () => {
        const parsed = parseFrontmatter(loadFixture(file));
        const serialized = serializeFrontmatter(parsed);
        const reparsed = parseFrontmatter(serialized);
        expect(reparsed.frontmatter).toEqual(parsed.frontmatter);
        expect(reparsed.body).toBe(parsed.body);
      });
    }
  });

  describe('parseFrontmatter', () => {
    it('returns empty frontmatter and original body when no opening fence', () => {
      const source = '# Hello\n\nNo frontmatter.\n';
      const result = parseFrontmatter(source);
      expect(result.frontmatter).toEqual({});
      expect(result.body).toBe(source);
    });

    it('treats an opening fence with no closing fence as no frontmatter', () => {
      const source = '---\nicon: "📘"\n\nbody without close fence';
      const result = parseFrontmatter(source);
      expect(result.frontmatter).toEqual({});
      expect(result.body).toBe(source);
    });

    it('handles an empty frontmatter block (---\\n---)', () => {
      const source = '---\n---\n\nhello\n';
      const result = parseFrontmatter(source);
      expect(result.frontmatter).toEqual({});
      expect(result.body).toBe('hello\n');
    });

    it('handles an empty frontmatter block followed immediately by EOF', () => {
      const source = '---\n---';
      const result = parseFrontmatter(source);
      expect(result.frontmatter).toEqual({});
      expect(result.body).toBe('');
    });

    it('handles CRLF line endings', () => {
      const source =
        '---\r\nicon: "📘"\r\ntitle: "Welcome"\r\n---\r\n\r\nbody\r\n';
      const result = parseFrontmatter(source);
      expect(result.frontmatter).toEqual({ icon: '📘', title: 'Welcome' });
      expect(result.body).toBe('body\r\n');
    });

    it('throws FrontmatterParseError on malformed YAML', () => {
      const source = '---\nicon: "📘\n---\n\nbody';
      expect(() => parseFrontmatter(source)).toThrow(FrontmatterParseError);
    });

    it('exposes the underlying cause on FrontmatterParseError for malformed YAML', () => {
      const source = '---\nicon: "📘\n---\n\nbody';
      try {
        parseFrontmatter(source);
        fail('expected parseFrontmatter to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(FrontmatterParseError);
        expect((err as FrontmatterParseError).cause).toBeDefined();
      }
    });

    it('throws FrontmatterParseError when frontmatter is a YAML list at top level', () => {
      const source = '---\n- one\n- two\n---\n\nbody\n';
      expect(() => parseFrontmatter(source)).toThrow(FrontmatterParseError);
      expect(() => parseFrontmatter(source)).toThrow(
        /mapping at the top level/,
      );
    });

    it('throws FrontmatterParseError when frontmatter is a scalar (number)', () => {
      const source = '---\n42\n---\n\nbody\n';
      try {
        parseFrontmatter(source);
        fail('expected parseFrontmatter to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(FrontmatterParseError);
        expect((err as FrontmatterParseError).cause).toBe(42);
      }
    });
  });

  describe('serializeFrontmatter', () => {
    it('returns just the body when frontmatter is empty', () => {
      const out = serializeFrontmatter({ frontmatter: {}, body: 'hello' });
      expect(out).toBe('hello');
    });

    it('emits fences and YAML when frontmatter is present', () => {
      const page: ParsedPage = {
        frontmatter: { icon: '📘', title: 'Welcome' },
        body: '# Welcome\n',
      };
      const out = serializeFrontmatter(page);
      expect(out.startsWith('---\n')).toBe(true);
      expect(out).toContain('icon: 📘');
      expect(out).toContain('title: Welcome');
      expect(out).toContain('---\n\n# Welcome\n');
    });

    it('preserves unknown frontmatter keys on serialize', () => {
      const page: ParsedPage = {
        frontmatter: { custom: 'value', nested: { foo: 'bar' } },
        body: 'hello',
      };
      const out = serializeFrontmatter(page);
      expect(out).toContain('custom: value');
      expect(out).toContain('nested:');
      expect(out).toContain('foo: bar');
    });

    it('round-trips unknown keys through parse -> serialize -> parse', () => {
      const original: ParsedPage = {
        frontmatter: {
          icon: '📘',
          customField: { nested: 'value', list: [1, 2, 3] },
          anotherKey: 42,
        },
        body: 'Body text.\n',
      };
      const serialized = serializeFrontmatter(original);
      const reparsed = parseFrontmatter(serialized);
      expect(reparsed.frontmatter).toEqual(original.frontmatter);
      expect(reparsed.body).toBe(original.body);
    });
  });

  describe('FrontmatterParseError', () => {
    it('has the correct name', () => {
      const err = new FrontmatterParseError('boom', null);
      expect(err.name).toBe('FrontmatterParseError');
      expect(err.message).toBe('boom');
      expect(err.cause).toBeNull();
      expect(err).toBeInstanceOf(Error);
    });
  });
});

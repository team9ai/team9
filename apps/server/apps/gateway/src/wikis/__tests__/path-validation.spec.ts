import { describe, it, expect } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';

import { validateWikiPath } from '../utils/path-validation.js';

describe('validateWikiPath', () => {
  // ── Happy paths ────────────────────────────────────────────────────────
  describe('accepts legitimate paths', () => {
    it.each([
      'foo.md',
      'docs/readme.md',
      'docs/api/v1/users.md',
      '.gitignore', // dot-prefixed file is fine
      'foo.bar/baz.md', // dot in segment is fine
      '..foo/bar.md', // segment *starts* with dots but isn't all-dots
      'foo..bar.md', // dots in the middle of a segment
      'a', // one-char path
      'a/b/c/d/e/f/g/h/i.md', // deep path
      'image (copy).png', // spaces + parens
      'résumé.md', // unicode is fine
    ])('accepts %p', (path) => {
      expect(() => validateWikiPath(path)).not.toThrow();
    });
  });

  // ── Rule 1: non-empty string ───────────────────────────────────────────
  describe('rejects empty / non-string inputs', () => {
    it('rejects an empty string', () => {
      expect(() => validateWikiPath('')).toThrow(BadRequestException);
    });

    it('rejects a non-string value (defensive: runtime callers may pass anything)', () => {
      expect(() => validateWikiPath(undefined as unknown as string)).toThrow(
        BadRequestException,
      );
      expect(() => validateWikiPath(null as unknown as string)).toThrow(
        BadRequestException,
      );
      expect(() => validateWikiPath(42 as unknown as string)).toThrow(
        BadRequestException,
      );
    });
  });

  // ── Rule 2: control characters ────────────────────────────────────────
  describe('rejects control characters', () => {
    it('rejects a null byte', () => {
      expect(() => validateWikiPath('foo\x00.md')).toThrow(BadRequestException);
    });

    it('rejects a newline', () => {
      expect(() => validateWikiPath('foo\nbar.md')).toThrow(
        BadRequestException,
      );
    });

    it('rejects a tab', () => {
      expect(() => validateWikiPath('foo\tbar.md')).toThrow(
        BadRequestException,
      );
    });

    it('rejects DEL (0x7F)', () => {
      expect(() => validateWikiPath('foo\x7Fbar.md')).toThrow(
        BadRequestException,
      );
    });
  });

  // ── Rule 3: leading slash ─────────────────────────────────────────────
  describe('rejects absolute paths', () => {
    it('rejects /etc/passwd', () => {
      expect(() => validateWikiPath('/etc/passwd')).toThrow(
        BadRequestException,
      );
    });

    it('rejects a single slash', () => {
      expect(() => validateWikiPath('/')).toThrow(BadRequestException);
    });
  });

  // ── Rule 4: .. traversal ──────────────────────────────────────────────
  describe('rejects .. traversal segments', () => {
    it.each([
      '../foo.md',
      '../../etc/passwd',
      'foo/../bar.md',
      'foo/..',
      '..',
      'a/b/../c.md',
    ])('rejects %p', (path) => {
      expect(() => validateWikiPath(path)).toThrow(BadRequestException);
    });
  });

  // ── Rule 5: all-dot segments ──────────────────────────────────────────
  describe('rejects all-dot segments', () => {
    it('rejects a bare "."', () => {
      expect(() => validateWikiPath('.')).toThrow(BadRequestException);
    });

    it('rejects "./" prefix (first segment is just ".")', () => {
      expect(() => validateWikiPath('./foo.md')).toThrow(BadRequestException);
    });

    it('rejects "foo/./bar.md" (middle segment is just ".")', () => {
      expect(() => validateWikiPath('foo/./bar.md')).toThrow(
        BadRequestException,
      );
    });

    it('rejects a segment of only three dots ("...") — Windows 8.3 short-name quirk', () => {
      expect(() => validateWikiPath('...')).toThrow(BadRequestException);
      expect(() => validateWikiPath('a/.../b.md')).toThrow(BadRequestException);
    });
  });

  // ── Rule 5: empty segments (doubled / trailing slashes) ──────────────
  describe('rejects empty segments', () => {
    it('rejects "foo//bar.md" (doubled slash → empty middle segment)', () => {
      expect(() => validateWikiPath('foo//bar.md')).toThrow(
        BadRequestException,
      );
    });

    it('rejects "foo/" (trailing slash → empty last segment)', () => {
      expect(() => validateWikiPath('foo/')).toThrow(BadRequestException);
    });

    it('rejects a single "/" (caller should not pass root to the validator)', () => {
      // `/` is caught by the leading-slash rule, but the invariant we want is
      // that no caller ever hands a path that splits to any empty segment.
      // Tested here so the reservation is explicit in the test file too.
      expect(() => validateWikiPath('/')).toThrow(BadRequestException);
    });
  });

  // ── Rule 7: reserved leading "-" on the first segment ─────────────────
  describe('rejects "-" as the first character of the top-level segment', () => {
    it('rejects "-review/anything.md" (first segment starts with "-")', () => {
      expect(() => validateWikiPath('-review/anything.md')).toThrow(
        BadRequestException,
      );
    });

    it('accepts "review-plan.md" (literal "-" not at start)', () => {
      expect(() => validateWikiPath('review-plan.md')).not.toThrow();
    });

    it('accepts nested segments that start with "-" (only top-level is reserved)', () => {
      // `foo/-bar.md` has `-bar.md` as its SECOND segment, which is
      // unrestricted. Only the top-level segment is gated because only the
      // top-level participates in the URL path that could collide with
      // `/wiki/:slug/-/review`.
      expect(() => validateWikiPath('foo/-bar.md')).not.toThrow();
    });
  });
});

import { BadRequestException } from '@nestjs/common';

/**
 * Reject paths that would escape the wiki root or confuse downstream
 * file-system semantics.
 *
 * folder9 is nominally a git-backed key-value store, not a POSIX filesystem,
 * but its server resolves `path` against a working directory on disk and
 * hands it to `filepath.Clean` — a trailing `..` segment happily climbs out
 * of the repo and we've seen comparable bugs in other integrations. This
 * helper is a defence-in-depth gate on the *team9* side so a compromised
 * client or bug in a proposing agent cannot pivot to a traversal attempt
 * even if folder9's own validation regresses.
 *
 * Rules:
 *   1. Path must be a non-empty string. Empty / whitespace-only strings are
 *      rejected at a higher layer already (see `requirePathQuery`), but we
 *      re-check here because this helper is also called from the commit
 *      DTO loop where the empty check hasn't run yet.
 *   2. No null bytes or ASCII control characters (0x00-0x1F, 0x7F). These
 *      have no legitimate use in a wiki file path and are the classic
 *      truncation vector (`foo\x00.md` → `foo` on some backends).
 *   3. No leading `/`. An absolute path would escape the wiki's virtual root
 *      on any filesystem-backed storage.
 *   4. No `..` segment. Split on `/` rather than substring-check so
 *      `..foo/bar` (legitimate: starts with dots) stays allowed while
 *      `../foo`, `foo/..`, `foo/../bar` are all blocked.
 *   5. No "all-dots" segment (e.g. `.`, `...`). `.` is the current-dir
 *      reference and adds no value. `...`+ are Windows 8.3 short-name quirks
 *      that historically bypassed naive filters.
 *
 * Permitted:
 *   - Dot-prefixed filenames (`.gitignore`, `.foo.md`)   — common in wikis.
 *   - Dot-suffixed directory names (`foo.bar/baz.md`)    — normal.
 *   - Leading `./` is rejected via rule 5 (`.` segment).
 *
 * Throws `BadRequestException` — the caller is responsible for converting
 * that to a 4xx at the NestJS boundary.
 */
export function validateWikiPath(path: string): void {
  if (typeof path !== 'string' || path.length === 0) {
    throw new BadRequestException('path must be a non-empty string');
  }

  // Rule 2: null bytes + control chars. Checked before anything else — a
  // null byte in the path means we can't trust the rest of the string.
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1F\x7F]/.test(path)) {
    throw new BadRequestException('path must not contain control characters');
  }

  // Rule 3: absolute paths escape the wiki root on filesystem backends.
  if (path.startsWith('/')) {
    throw new BadRequestException('path must not start with "/"');
  }

  // Rules 4 + 5: segment-level checks. Splitting on `/` means a literal
  // `..foo/bar.md` is fine (segment `..foo` is neither `..` nor all-dots),
  // but `foo/../bar.md` rejects on the `..` segment and `foo/./bar.md`
  // rejects on the `.` segment.
  const segments = path.split('/');
  for (const seg of segments) {
    if (seg === '..') {
      throw new BadRequestException(
        'path must not contain ".." traversal segments',
      );
    }
    // A segment of only dots (`.`, `..`, `...`, ...) is never a legitimate
    // file/directory name in a wiki. `..` is caught above but we keep the
    // dedicated branch so the error message distinguishes the two cases.
    if (seg.length > 0 && /^\.+$/.test(seg)) {
      throw new BadRequestException(
        'path must not contain segments that are only dots',
      );
    }
  }
}

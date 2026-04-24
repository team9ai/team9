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
 *      on any filesystem-backed storage. Callers that need to represent
 *      "root" (e.g. `getTree`'s default) must do so WITHOUT invoking
 *      `validateWikiPath` — the service guards the call site with an
 *      `opts.path !== "/"` check.
 *   4. No `..` segment. Split on `/` rather than substring-check so
 *      `..foo/bar` (legitimate: starts with dots) stays allowed while
 *      `../foo`, `foo/..`, `foo/../bar` are all blocked.
 *   5. No empty segment. `foo//bar`, `foo/`, and any doubled/trailing slash
 *      splits to an empty segment, which is never a legitimate file or
 *      directory name. Rejecting up-front is simpler than trusting folder9's
 *      `filepath.Clean` to collapse consistently, and closes a tiny gap
 *      where an empty segment could sneak past the all-dots regex below.
 *   6. No "all-dots" segment (e.g. `.`, `...`). `.` is the current-dir
 *      reference and adds no value. `...`+ are Windows 8.3 short-name quirks
 *      that historically bypassed naive filters.
 *   7. The FIRST segment must not start with `-`. This is a permanent
 *      reservation so route prefixes like `/wiki/:slug/-/review` can never
 *      collide with a user-authored path (see B-6). Only literal leading `-`
 *      on the top-level segment is banned — `review-plan.md`, `foo/-bar.md`,
 *      and deeper segments starting with `-` all stay allowed.
 *
 * Permitted:
 *   - Dot-prefixed filenames (`.gitignore`, `.foo.md`)   — common in wikis.
 *   - Dot-suffixed directory names (`foo.bar/baz.md`)    — normal.
 *   - Leading `./` is rejected via rule 6 (`.` segment).
 *
 * Throws `BadRequestException` — the caller is responsible for converting
 * that to a 4xx at the NestJS boundary.
 */
export function validateWikiPath(path: string): void {
  if (typeof path !== 'string' || path.length === 0) {
    throw new BadRequestException('path must be a non-empty string');
  }

  // Defense-in-depth length cap. 500 is generous relative to realistic wiki
  // paths (filesystem MAX_PATH on POSIX is already 4096 and folder9's own
  // limits are looser) but tight enough to block pathological inputs that
  // could inflate audit logs / filesystem calls. Checked before the
  // character-level rules below so a malicious megabyte-long path doesn't
  // hit the regex/split work.
  if (path.length > 500) {
    throw new BadRequestException('wiki path exceeds 500 characters');
  }

  // Rule 2: null bytes + control chars. Checked before anything else — a
  // null byte in the path means we can't trust the rest of the string.
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1F\x7F]/.test(path)) {
    throw new BadRequestException('path must not contain control characters');
  }

  // Rule 3: absolute paths escape the wiki root on filesystem backends.
  // Also catches bare "/" — callers that mean "root" must not invoke this
  // helper at all.
  if (path.startsWith('/')) {
    throw new BadRequestException('path must not start with "/"');
  }

  // Rules 4-7: segment-level checks. Splitting on `/` means a literal
  // `..foo/bar.md` is fine (segment `..foo` is neither `..` nor all-dots),
  // but `foo/../bar.md` rejects on the `..` segment and `foo/./bar.md`
  // rejects on the `.` segment.
  const segments = path.split('/');
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    // Rule 5: empty segments (`foo//bar`, `foo/`, trailing slashes). Must
    // come before the all-dots check below so the `^\.+$` regex never sees
    // an empty string (it would otherwise match since `+` is greedy on zero
    // dots... actually `+` requires one, but an empty string would also
    // harmlessly miss that branch and fall through as "allowed" — which is
    // the bug we're closing here).
    if (seg.length === 0) {
      throw new BadRequestException(
        'path must not contain empty segments (doubled or trailing "/")',
      );
    }
    if (seg === '..') {
      throw new BadRequestException(
        'path must not contain ".." traversal segments',
      );
    }
    // A segment of only dots (`.`, `..`, `...`, ...) is never a legitimate
    // file/directory name in a wiki. `..` is caught above but we keep the
    // dedicated branch so the error message distinguishes the two cases.
    if (/^\.+$/.test(seg)) {
      throw new BadRequestException(
        'path must not contain segments that are only dots',
      );
    }
    // Rule 7: reserve leading `-` on the FIRST segment for system routes
    // (e.g. `/wiki/:slug/-/review`). Only the top-level segment is gated —
    // nested files/dirs may start with `-` freely.
    if (i === 0 && seg.startsWith('-')) {
      throw new BadRequestException(
        'top-level path segment must not start with "-" (reserved for system routes)',
      );
    }
  }
}

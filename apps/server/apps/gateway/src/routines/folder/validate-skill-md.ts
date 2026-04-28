/**
 * Pure helper that validates the SKILL.md content read from a routine's
 * folder9 folder before {@link import('../routines.service.js').RoutinesService}
 * finalizes a draft via `completeCreation`.
 *
 * # Why a hand-rolled parser, not gray-matter
 *
 * The frontmatter shape is fixed and tightly controlled by us — a
 * three-line YAML block (`name`, `description`) at the top of the file,
 * separated from the body by `---` fences. The gateway already depends on
 * `yaml` for other features, so we lean on that for the YAML payload and
 * detect the fences manually. This keeps the dependency graph lean and
 * avoids pulling in gray-matter's CommonJS shape.
 *
 * # Validation rules (per design spec §"`finishRoutineCreation`
 * Server-side Validation")
 *
 * 1. Frontmatter block exists and parses cleanly as YAML.
 * 2. Frontmatter `name` is a string equal to `<expectedSkillName>`
 *    (typically `routine-<slug>`).
 * 3. Frontmatter `description` is a non-empty string AND, after trim,
 *    equals the routine record's `description` (also trimmed). Trim on
 *    both sides keeps the agent forgiving of trailing newlines.
 * 4. Body (post-frontmatter) is non-empty after trim AND ≥ 20 chars.
 *
 * Each failure returns a SPECIFIC reason string mentioning the failed
 * rule — the agent surfaces this back to the user via the
 * `finishRoutineCreation` tool response, so generic "validation failed"
 * messages would block the agent from self-correcting.
 *
 * # Failure shape
 *
 * Returns `{ ok: false, reason }` on any rule violation; never throws.
 * The caller (RoutinesService.completeCreation) wraps the failure into
 * `{ success: false, error }` for the agent — see service docstring.
 */

import { parse as parseYaml } from 'yaml';

/**
 * Minimum body character count after trim. The threshold is intentionally
 * low (a one-line steps list satisfies it) — the goal is to reject empty
 * scaffolds, not to gate on prose length.
 */
export const MIN_BODY_CHARS = 20;

/**
 * Result of a single validation pass. Always one of two shapes — never
 * a partial object — so consumers can `if (!result.ok) ...` and TypeScript
 * narrows `reason` correctly.
 */
export type ValidationResult = { ok: true } | { ok: false; reason: string };

/**
 * Match a leading `---` fence on its own line, then capture frontmatter
 * up to the closing `---` fence on its own line, followed by an optional
 * trailing newline. The body is everything after.
 *
 * - `^` anchors to the file start (no leading whitespace tolerance — folder9
 *   commits the file verbatim and our writers never insert a BOM or blank
 *   line above the fence).
 * - `\r?\n` accepts Windows line endings.
 * - `[\s\S]*?` lazy-matches frontmatter content across newlines so we stop
 *   at the FIRST closing fence.
 */
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/**
 * Validate the contents of a routine's `SKILL.md` against the expected
 * frontmatter and body invariants.
 *
 * @param content              Full file text as read back from folder9.
 * @param expectedSkillName    Required value for frontmatter `name`.
 *                             Typically `routine-<slugifyUuid(routineId)>`.
 * @param expectedDescription  Required value for frontmatter `description`,
 *                             compared post-trim. Source of truth is the
 *                             `routines.description` column.
 *
 * @returns `{ ok: true }` on success, `{ ok: false, reason }` on any failure.
 *          Never throws.
 */
export function validateSkillMd(
  content: string,
  expectedSkillName: string,
  expectedDescription: string,
): ValidationResult {
  if (typeof content !== 'string' || content.length === 0) {
    return {
      ok: false,
      reason: 'SKILL.md is empty or missing',
    };
  }

  const match = FRONTMATTER_RE.exec(content);
  if (!match) {
    return {
      ok: false,
      reason:
        'SKILL.md frontmatter block is missing or malformed (expected leading and closing "---" fences)',
    };
  }

  const [, rawFrontmatter, rawBody] = match;

  let parsed: unknown;
  try {
    parsed = parseYaml(rawFrontmatter);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      reason: `SKILL.md frontmatter parse failed: ${msg}`,
    };
  }

  // YAML can legitimately parse to non-object values (e.g. a bare string,
  // number, or null). Anything that isn't a plain object means the agent
  // wrote something we don't know how to read — treat it as a frontmatter
  // failure with a descriptive reason rather than crashing on field access.
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false,
      reason: 'SKILL.md frontmatter must be a YAML object',
    };
  }

  const fm = parsed as Record<string, unknown>;

  if (typeof fm.name !== 'string') {
    return {
      ok: false,
      reason: `SKILL.md frontmatter "name" must be a string`,
    };
  }
  if (fm.name !== expectedSkillName) {
    return {
      ok: false,
      reason: `SKILL.md frontmatter "name" must equal "${expectedSkillName}" (got "${fm.name}")`,
    };
  }

  if (typeof fm.description !== 'string') {
    return {
      ok: false,
      reason: 'SKILL.md frontmatter "description" must be a string',
    };
  }
  const fmDesc = fm.description.trim();
  if (fmDesc.length === 0) {
    return {
      ok: false,
      reason: 'SKILL.md frontmatter "description" must be non-empty',
    };
  }
  // Trim on both sides — the routine record's description may have a
  // trailing newline picked up via copy/paste, and we don't want to fail
  // validation over invisible whitespace.
  if (fmDesc !== expectedDescription.trim()) {
    return {
      ok: false,
      reason:
        'SKILL.md frontmatter "description" must match the routine description exactly',
    };
  }

  const body = (rawBody ?? '').trim();
  if (body.length === 0) {
    return {
      ok: false,
      reason: 'SKILL.md body must not be empty',
    };
  }
  if (body.length < MIN_BODY_CHARS) {
    return {
      ok: false,
      reason: `SKILL.md body must be at least ${MIN_BODY_CHARS} characters after trim`,
    };
  }

  return { ok: true };
}

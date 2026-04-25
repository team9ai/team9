import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

/**
 * Error thrown when frontmatter YAML is malformed or not an object at the top
 * level. Use `.cause` to inspect the underlying failure (either the YAML
 * parser's exception or the non-object value that was decoded).
 *
 * This is the browser-side twin of the gateway's `FrontmatterParseError`
 * (apps/server/apps/gateway/src/wikis/utils/frontmatter.ts). The two
 * implementations share fixtures under
 * `apps/server/libs/shared/test-fixtures/wiki-frontmatter/` to stay in
 * lockstep.
 */
export class FrontmatterParseError extends Error {
  constructor(
    message: string,
    public readonly cause: unknown,
  ) {
    super(message);
    this.name = "FrontmatterParseError";
  }
}

export interface ParsedPage {
  frontmatter: Record<string, unknown>;
  body: string;
}

const FENCE = "---";
const OPEN_RE = /^---\r?\n/;
// Matches a closing fence: a line containing exactly "---". It may appear at
// the very start of the post-open source (empty frontmatter block) or after
// a preceding newline, and it may be followed by another newline or EOF.
const CLOSE_RE = /(^|\r?\n)---(\r?\n|$)/;

/**
 * Parse a markdown source with optional YAML frontmatter. Returns an empty
 * frontmatter object when the source has no opening fence, or when an opening
 * fence has no matching close fence. Throws `FrontmatterParseError` if the
 * YAML is malformed or decodes to a non-object value (e.g. a top-level list).
 */
export function parseFrontmatter(source: string): ParsedPage {
  if (!OPEN_RE.test(source)) {
    return { frontmatter: {}, body: source };
  }

  const afterOpen = source.replace(OPEN_RE, "");
  const closeMatch = CLOSE_RE.exec(afterOpen);
  if (!closeMatch) {
    // Open fence with no matching close — not a frontmatter block.
    return { frontmatter: {}, body: source };
  }

  const yamlSource = afterOpen.slice(0, closeMatch.index);
  const afterClose = afterOpen.slice(closeMatch.index + closeMatch[0].length);
  const body = afterClose.replace(/^\r?\n/, "");

  let fm: unknown;
  try {
    fm = parseYaml(yamlSource);
  } catch (cause) {
    throw new FrontmatterParseError("Invalid frontmatter YAML", cause);
  }

  if (fm == null) {
    return { frontmatter: {}, body };
  }
  if (typeof fm !== "object" || Array.isArray(fm)) {
    throw new FrontmatterParseError(
      "Frontmatter must be a YAML mapping at the top level",
      fm,
    );
  }

  return { frontmatter: fm as Record<string, unknown>, body };
}

/**
 * Serialize a `ParsedPage` back into a markdown source. An empty frontmatter
 * object produces no fence block at all — `serializeFrontmatter({ frontmatter:
 * {}, body: 'x' })` returns just `'x'`. When a frontmatter object is present,
 * the fences and YAML block are re-emitted, followed by a blank line and the
 * body.
 */
export function serializeFrontmatter(page: ParsedPage): string {
  const { frontmatter, body } = page;
  if (Object.keys(frontmatter).length === 0) {
    return body;
  }

  const yaml = stringifyYaml(frontmatter).trimEnd();
  return `${FENCE}\n${yaml}\n${FENCE}\n\n${body}`;
}

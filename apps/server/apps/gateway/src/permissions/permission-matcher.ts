import { minimatch } from 'minimatch';

type Scalar = string | number | boolean;
type Metadata = Record<string, unknown>;

const PLURAL_TO_SINGULAR: Record<string, string> = {
  channelIds: 'channelId',
  channelTypes: 'channelType',
  toolNames: 'toolName',
  targets: 'target',
  routineIds: 'routineId',
  wikiIds: 'wikiId',
  paths: 'path',
};

function pluralLookup(req: Metadata, scopeKey: string): unknown {
  if (scopeKey in req) return req[scopeKey];
  const singular = PLURAL_TO_SINGULAR[scopeKey];
  return singular ? req[singular] : undefined;
}

function matchesField(reqValue: unknown, scopeValue: unknown): boolean {
  if (Array.isArray(scopeValue)) {
    if (reqValue === undefined) return false;
    return (scopeValue as Scalar[]).includes(reqValue as Scalar);
  }
  if (typeof scopeValue === 'string') {
    if (reqValue === undefined) return false;
    if (scopeValue.startsWith('glob:')) {
      return minimatch(
        typeof reqValue === 'string' ? reqValue : JSON.stringify(reqValue),
        scopeValue.slice('glob:'.length),
      );
    }
    return reqValue === scopeValue;
  }
  // Numbers / booleans → strict equality
  if (reqValue === undefined) return false;
  return reqValue === scopeValue;
}

/**
 * Returns true if `override` is a tightening (subset) of `original`.
 * Tightening rules:
 * - Override missing a key that the original constrained → broadens → false
 * - Override array must be a subset of original array (or single value in array)
 * - Override string must equal original string
 * - Override may add NEW keys (extra constraints) → narrowing → true
 */
export function isScopeNarrowing(
  override: Record<string, unknown>,
  original: Record<string, unknown>,
): boolean {
  for (const [key, originalValue] of Object.entries(original)) {
    if (!(key in override)) return false;
    const overrideValue = override[key];
    if (Array.isArray(originalValue)) {
      if (Array.isArray(overrideValue)) {
        for (const v of overrideValue) {
          if (!originalValue.includes(v as never)) return false;
        }
      } else if (typeof overrideValue === 'string') {
        if (!originalValue.includes(overrideValue as never)) return false;
      } else {
        return false;
      }
    } else if (typeof originalValue === 'string') {
      if (overrideValue !== originalValue) return false;
    } else {
      // For other primitives, require strict equality
      if (overrideValue !== originalValue) return false;
    }
  }
  return true;
}

export function matchesScope(requested: Metadata, scope: Metadata): boolean {
  for (const [key, scopeValue] of Object.entries(scope)) {
    const reqValue = pluralLookup(requested, key);
    if (!matchesField(reqValue, scopeValue)) return false;
  }
  return true;
}

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

export function matchesScope(requested: Metadata, scope: Metadata): boolean {
  for (const [key, scopeValue] of Object.entries(scope)) {
    const reqValue = pluralLookup(requested, key);
    if (!matchesField(reqValue, scopeValue)) return false;
  }
  return true;
}

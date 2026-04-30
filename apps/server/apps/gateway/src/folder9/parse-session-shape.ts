/**
 * Discriminated union describing the shape of a team9 sessionId.
 *
 * sessionIds follow the canonical layout:
 *   `team9/{tenantId}/{agentId}/{scope}/{scopeId...}`
 *
 * Anything that doesn't match — wrong prefix, missing segments, or an
 * unrecognized scope — collapses to `{kind: 'unknown'}` so callers can
 * decide whether to reject (e.g. `FolderMapBuilder` throws BadRequest)
 * or silently ignore (other consumers may treat unknown sessions as
 * non-team9 traffic).
 */
export type SessionShape =
  | { kind: 'dm'; tenantId: string; agentId: string; channelId: string }
  | { kind: 'channel'; tenantId: string; agentId: string; channelId: string }
  | { kind: 'routine'; tenantId: string; agentId: string; routineId: string }
  | { kind: 'topic'; tenantId: string; agentId: string; topicId: string }
  | { kind: 'unknown' };

/**
 * Pure parser — no side effects, no I/O. Splits a sessionId into its
 * tenant/agent/scope tuple and returns a discriminated union the
 * folder-map / token authz layers can switch on.
 *
 * Any segment after the 4th `/` is folded into `scopeId` (so paths like
 * `team9/ten/agent/channel/C/sub/path` keep the trailing `C/sub/path`
 * intact rather than dropping it). Empty `scopeId` is treated as
 * malformed.
 */
export function parseSessionShape(sessionId: string): SessionShape {
  const parts = sessionId.split('/');
  if (parts.length < 5 || parts[0] !== 'team9') return { kind: 'unknown' };
  const [, tenantId, agentId, scope, ...rest] = parts;
  const scopeId = rest.join('/');
  if (!scopeId) return { kind: 'unknown' };
  switch (scope) {
    case 'dm':
      return { kind: 'dm', tenantId, agentId, channelId: scopeId };
    case 'channel':
      return { kind: 'channel', tenantId, agentId, channelId: scopeId };
    case 'routine':
      return { kind: 'routine', tenantId, agentId, routineId: scopeId };
    case 'topic':
      return { kind: 'topic', tenantId, agentId, topicId: scopeId };
    default:
      return { kind: 'unknown' };
  }
}

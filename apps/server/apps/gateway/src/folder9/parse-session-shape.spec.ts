import { describe, it, expect } from '@jest/globals';
import { parseSessionShape } from './parse-session-shape.js';

// `parseSessionShape` is a pure string parser, so tests are direct
// input/output assertions — no mocks, no Nest harness. We deliberately
// cover every branch of the switch + every early-return path so the
// 100% branch coverage requirement holds without relying on
// `FolderMapBuilder` to also exercise the parser.

describe('parseSessionShape', () => {
  it('parses dm scope', () => {
    expect(parseSessionShape('team9/ten-1/agent-x/dm/C_123')).toEqual({
      kind: 'dm',
      tenantId: 'ten-1',
      agentId: 'agent-x',
      channelId: 'C_123',
    });
  });

  it('parses channel scope', () => {
    expect(parseSessionShape('team9/ten-1/agent-x/channel/C_pub')).toEqual({
      kind: 'channel',
      tenantId: 'ten-1',
      agentId: 'agent-x',
      channelId: 'C_pub',
    });
  });

  it('parses routine scope', () => {
    expect(parseSessionShape('team9/ten-1/agent-x/routine/r-7')).toEqual({
      kind: 'routine',
      tenantId: 'ten-1',
      agentId: 'agent-x',
      routineId: 'r-7',
    });
  });

  it('parses topic scope', () => {
    expect(parseSessionShape('team9/ten-1/agent-x/topic/t-42')).toEqual({
      kind: 'topic',
      tenantId: 'ten-1',
      agentId: 'agent-x',
      topicId: 't-42',
    });
  });

  it('returns unknown on missing team9 prefix', () => {
    // First segment must literally be `team9` — anything else is
    // treated as foreign traffic (e.g. older sessionId schemes).
    expect(parseSessionShape('foo/ten/agent/dm/C')).toEqual({
      kind: 'unknown',
    });
  });

  it('returns unknown when there are too few parts', () => {
    // Need at least 5 segments to extract scopeId; a 4-segment id
    // (no scopeId) is malformed.
    expect(parseSessionShape('team9/ten/agent/dm')).toEqual({
      kind: 'unknown',
    });
  });

  it('returns unknown on unrecognized scope', () => {
    // Scope must be one of dm/channel/routine/topic — the default
    // arm of the switch falls through to `unknown`.
    expect(parseSessionShape('team9/ten/agent/weird/X')).toEqual({
      kind: 'unknown',
    });
  });

  it('preserves slashes inside scopeId', () => {
    // Slashes after the 4th separator are part of the scopeId.
    // This guards against accidentally truncating multi-segment ids.
    expect(parseSessionShape('team9/ten/agent/channel/C/sub/path')).toEqual({
      kind: 'channel',
      tenantId: 'ten',
      agentId: 'agent',
      channelId: 'C/sub/path',
    });
  });

  it('returns unknown when scopeId is empty', () => {
    // Trailing slash with nothing after it produces an empty
    // scopeId, which we treat as malformed rather than letting an
    // empty string flow through to `channelId` / `routineId`.
    expect(parseSessionShape('team9/ten/agent/dm/')).toEqual({
      kind: 'unknown',
    });
  });
});

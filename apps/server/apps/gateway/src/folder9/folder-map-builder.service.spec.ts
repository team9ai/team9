import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';

// `FolderMapBuilder` only depends on `FolderMountResolver` (and the
// pure `parseSessionShape` helper). The resolver is a class instance
// in production, but here we wire a minimal jest.fn-backed double so
// every test can drive return values + assert call payloads without
// touching Drizzle/Folder9 fakes.

import { FolderMapBuilder } from './folder-map-builder.service.js';
import type { FolderMountResolver } from './folder-mount-resolver.service.js';

type ProvisionFn = FolderMountResolver['provisionFolderForMount'];

function buildHarness() {
  const provisionFolderForMount = jest.fn<ProvisionFn>();
  // Default: every call resolves to a deterministic id derived from
  // the args, so tests that don't override can still assert on
  // result shape. Individual tests override per-case via
  // `mockResolvedValueOnce` / `mockImplementation`.
  provisionFolderForMount.mockImplementation(async (args) => {
    return {
      folder9FolderId: `folder-${args.scope}-${args.scopeId}-${args.mountKey}`,
    };
  });
  const resolver = {
    provisionFolderForMount,
  } as unknown as FolderMountResolver;
  const builder = new FolderMapBuilder(resolver);
  return { builder, provisionFolderForMount };
}

const DM_SESSION = 'team9/ten-1/agent-x/dm/C_dm';
const CHANNEL_SESSION = 'team9/ten-1/agent-x/channel/C_pub';
const ROUTINE_SESSION = 'team9/ten-1/agent-x/routine/r-7';
const TOPIC_SESSION = 'team9/ten-1/agent-x/topic/t-42';

describe('FolderMapBuilder', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('emits session.* + agent.* + user.* for a DM session with userId', async () => {
    const { builder, provisionFolderForMount } = buildHarness();

    const { folderMap } = await builder.buildFolderMap({
      sessionId: DM_SESSION,
      agentId: 'agent-x',
      userId: 'user-7',
    });

    expect(Object.keys(folderMap).sort()).toEqual([
      'agent.home',
      'agent.tmp',
      'session.home',
      'session.tmp',
      'user.home',
      'user.tmp',
    ]);

    // Every entry uses tenantId from the parsed sessionId as workspaceId,
    // is a `light` folder, and carries write permission per the v1 spec.
    for (const entry of Object.values(folderMap)) {
      expect(entry).toMatchObject({
        workspaceId: 'ten-1',
        folderType: 'light',
        permission: 'write',
      });
      expect(entry.folderId).toMatch(/^folder-/);
    }

    // session.* uses the full sessionId as scopeId (NOT just the channelId).
    expect(provisionFolderForMount).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'session',
        scopeId: DM_SESSION,
        mountKey: 'home',
        ownerType: 'workspace',
        ownerId: 'ten-1',
      }),
    );

    // user.* scopeId is the userId, with workspace ownership (DM
    // peer's folder lives at workspace tenancy in v1).
    expect(provisionFolderForMount).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'user',
        scopeId: 'user-7',
        mountKey: 'tmp',
        ownerType: 'workspace',
        ownerId: 'ten-1',
      }),
    );
  });

  it('omits user.* when DM session has no userId', async () => {
    const { builder, provisionFolderForMount } = buildHarness();

    const { folderMap } = await builder.buildFolderMap({
      sessionId: DM_SESSION,
      agentId: 'agent-x',
      // userId intentionally omitted
    });

    expect(Object.keys(folderMap).sort()).toEqual([
      'agent.home',
      'agent.tmp',
      'session.home',
      'session.tmp',
    ]);

    // No user-scope provisioning calls were made.
    const userCalls = provisionFolderForMount.mock.calls.filter(
      ([args]) => args.scope === 'user',
    );
    expect(userCalls).toHaveLength(0);
  });

  it('emits session.* + agent.* only for a channel session (no user.*, no routine.*)', async () => {
    const { builder, provisionFolderForMount } = buildHarness();

    const { folderMap } = await builder.buildFolderMap({
      sessionId: CHANNEL_SESSION,
      agentId: 'agent-x',
      // Channel sessions never get user.* even if userId is present —
      // userId is meaningful only for DM. We pass it here to verify
      // it's ignored.
      userId: 'user-7',
    });

    expect(Object.keys(folderMap).sort()).toEqual([
      'agent.home',
      'agent.tmp',
      'session.home',
      'session.tmp',
    ]);

    // No user.* or routine.* provisioning happened.
    const nonBaseCalls = provisionFolderForMount.mock.calls.filter(
      ([args]) => args.scope === 'user' || args.scope === 'routine',
    );
    expect(nonBaseCalls).toHaveLength(0);
  });

  it('emits routine.{tmp,home} for a routine session with routineId — and never routine.document', async () => {
    const { builder, provisionFolderForMount } = buildHarness();

    const { folderMap } = await builder.buildFolderMap({
      sessionId: ROUTINE_SESSION,
      agentId: 'agent-x',
      routineId: 'r-7',
    });

    expect(Object.keys(folderMap).sort()).toEqual([
      'agent.home',
      'agent.tmp',
      'routine.home',
      'routine.tmp',
      'session.home',
      'session.tmp',
    ]);

    // routine.document is owned by the routine creation flow and must
    // NOT appear in the folder-map response.
    expect(folderMap).not.toHaveProperty('routine.document');

    // Verify routine.* provisioning args: scope=routine, ownerType=agent,
    // ownerId=agentId.
    const routineCalls = provisionFolderForMount.mock.calls.filter(
      ([args]) => args.scope === 'routine',
    );
    expect(routineCalls).toHaveLength(2);
    expect(
      routineCalls.every(
        ([args]) =>
          args.scopeId === 'r-7' &&
          args.ownerType === 'agent' &&
          args.ownerId === 'agent-x' &&
          args.folderType === 'light',
      ),
    ).toBe(true);

    // Mount keys for routine.* are exactly tmp + home (no document).
    const routineMountKeys = routineCalls.map(([args]) => args.mountKey).sort();
    expect(routineMountKeys).toEqual(['home', 'tmp']);
  });

  it('omits routine.* on a routine session when routineId is not provided', async () => {
    // Even if the sessionId says `routine`, without an explicit
    // routineId in the build context we can't materialise routine.*.
    // The session+agent baseline still emits.
    const { builder, provisionFolderForMount } = buildHarness();

    const { folderMap } = await builder.buildFolderMap({
      sessionId: ROUTINE_SESSION,
      agentId: 'agent-x',
    });

    expect(Object.keys(folderMap).sort()).toEqual([
      'agent.home',
      'agent.tmp',
      'session.home',
      'session.tmp',
    ]);
    const routineCalls = provisionFolderForMount.mock.calls.filter(
      ([args]) => args.scope === 'routine',
    );
    expect(routineCalls).toHaveLength(0);
  });

  it('emits session.* + agent.* only for a topic session', async () => {
    // Topic sessions are recognized but the v1 spec doesn't define
    // any topic-specific mounts — they fall into the same baseline
    // emission pattern as channel sessions.
    const { builder } = buildHarness();

    const { folderMap } = await builder.buildFolderMap({
      sessionId: TOPIC_SESSION,
      agentId: 'agent-x',
    });

    expect(Object.keys(folderMap).sort()).toEqual([
      'agent.home',
      'agent.tmp',
      'session.home',
      'session.tmp',
    ]);
  });

  it('throws BadRequestException when routineId is provided but sessionId scope is not routine', async () => {
    // This is the safety net for the controller layer: callers must
    // not silently get a routine.* mount tied to an unrelated DM session.
    const { builder, provisionFolderForMount } = buildHarness();

    await expect(
      builder.buildFolderMap({
        sessionId: DM_SESSION,
        agentId: 'agent-x',
        routineId: 'r-7',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    // No resolver calls happened — we reject before any I/O.
    expect(provisionFolderForMount).not.toHaveBeenCalled();
  });

  it('throws BadRequestException when agentId does not match sessionId agent segment', async () => {
    const { builder, provisionFolderForMount } = buildHarness();

    await expect(
      builder.buildFolderMap({
        sessionId: DM_SESSION,
        agentId: 'other-agent',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(provisionFolderForMount).not.toHaveBeenCalled();
  });

  it('throws BadRequestException when sessionId is unparseable', async () => {
    const { builder, provisionFolderForMount } = buildHarness();

    await expect(
      builder.buildFolderMap({
        sessionId: 'not-a-team9-session-id',
        agentId: 'agent-x',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(provisionFolderForMount).not.toHaveBeenCalled();
  });

  it('propagates resolver-level failures (e.g. Folder9 outage)', async () => {
    // FolderMapBuilder doesn't catch resolver errors — Folder9 outages
    // surface as the resolver's ServiceUnavailableException and bubble
    // up to the caller / controller layer.
    const { builder, provisionFolderForMount } = buildHarness();
    provisionFolderForMount.mockReset();
    provisionFolderForMount.mockRejectedValueOnce(new Error('folder9 down'));

    await expect(
      builder.buildFolderMap({
        sessionId: DM_SESSION,
        agentId: 'agent-x',
      }),
    ).rejects.toThrow('folder9 down');
  });

  it('uses sessionId tenantId as workspaceId for every mount call', async () => {
    // Regression guard: it would be tempting to pass agentId as the
    // workspaceId, but workspace tenancy is determined exclusively by
    // the sessionId prefix. This ensures every resolver call (incl.
    // user.*) carries the parsed tenantId.
    const { builder, provisionFolderForMount } = buildHarness();

    await builder.buildFolderMap({
      sessionId: DM_SESSION,
      agentId: 'agent-x',
      userId: 'user-7',
    });

    for (const [args] of provisionFolderForMount.mock.calls) {
      expect(args.workspaceId).toBe('ten-1');
    }
  });
});

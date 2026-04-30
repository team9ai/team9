import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// ── Module mocks ─────────────────────────────────────────────────────────────
//
// `FolderMountResolver` imports from `@team9/database` (DATABASE_CONNECTION,
// `and`, `eq`, PostgresJsDatabase) and `@team9/database/schemas`
// (workspaceFolderMounts). We replace both with lightweight test doubles so
// the resolver is exercised in isolation against a chainable Drizzle stub.

const dbModule = {
  DATABASE_CONNECTION: Symbol('DATABASE_CONNECTION'),
  eq: jest.fn((left: unknown, right: unknown) => ({ op: 'eq', left, right })),
  and: jest.fn((...clauses: unknown[]) => ({ op: 'and', clauses })),
};

const schemaModule = {
  workspaceFolderMounts: {
    workspaceId: 'wfm.workspace_id',
    scope: 'wfm.scope',
    scopeId: 'wfm.scope_id',
    mountKey: 'wfm.mount_key',
    folderType: 'wfm.folder_type',
    folder9FolderId: 'wfm.folder9_folder_id',
  },
};

jest.unstable_mockModule('@team9/database', () => dbModule);
jest.unstable_mockModule('@team9/database/schemas', () => schemaModule);

const { FolderMountResolver } =
  await import('./folder-mount-resolver.service.js');

const { Folder9ApiError } = await import('../wikis/types/folder9.types.js');

import { ServiceUnavailableException } from '@nestjs/common';

// ── Drizzle test double ──────────────────────────────────────────────────────
//
// The resolver issues:
//   - select(...).from(...).where(...).limit(1)  (SELECT)
//   - insert(...).values(...).onConflictDoNothing() (race-safe INSERT)
//
// We expose two queues: `selectMock` returns successive SELECT results;
// `insertMock` is the spy on `.values(...)` so callers can assert insert
// payload AND drive the `.onConflictDoNothing()` continuation.

type MockFn = jest.Mock<(...args: any[]) => any>;

function buildHarness() {
  const folder9 = {
    createFolder: jest.fn<(...args: any[]) => any>(),
  };

  const selectMock: MockFn = jest.fn();
  const insertMock: MockFn = jest.fn();

  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(selectMock()),
        }),
      }),
    }),
    insert: () => ({
      values: insertMock,
    }),
  };

  // `as never` here mirrors how folder-token.service.spec.ts threads the
  // mocked db/folder9Client into the constructor — Drizzle/Folder9 types
  // are huge and irrelevant to the unit's branching logic.
  const resolver = new FolderMountResolver(db as never, folder9 as never);

  return { resolver, folder9, selectMock, insertMock };
}

const BASE_ARGS = {
  workspaceId: 'ws-1',
  scope: 'session' as const,
  scopeId: 'sess-A',
  mountKey: 'home' as const,
  folderType: 'light' as const,
  ownerType: 'workspace' as const,
  ownerId: 'ws-1',
};

describe('FolderMountResolver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns existing folder on cache hit (no Folder9 call, no insert)', async () => {
    const { resolver, folder9, selectMock, insertMock } = buildHarness();
    selectMock.mockReturnValue([{ folder9FolderId: 'cached-id' }]);

    const result = await resolver.provisionFolderForMount(BASE_ARGS);

    expect(result.folder9FolderId).toBe('cached-id');
    expect(folder9.createFolder).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('lazy creates on miss: createFolder + insert + re-select', async () => {
    const { resolver, folder9, selectMock, insertMock } = buildHarness();
    // First select: empty (cache miss). Second select (after INSERT): row found.
    selectMock
      .mockReturnValueOnce([])
      .mockReturnValueOnce([{ folder9FolderId: 'new-id' }]);
    folder9.createFolder.mockResolvedValue({ id: 'new-id' });
    insertMock.mockReturnValue({
      onConflictDoNothing: () => Promise.resolve(),
    });

    const result = await resolver.provisionFolderForMount({
      ...BASE_ARGS,
      scope: 'agent',
      scopeId: 'bot-X',
      ownerType: 'agent',
      ownerId: 'bot-X',
    });

    expect(folder9.createFolder).toHaveBeenCalledTimes(1);
    const [wsArg, inputArg] = folder9.createFolder.mock.calls[0];
    expect(wsArg).toBe('ws-1');
    expect(inputArg).toEqual(
      expect.objectContaining({
        type: 'light',
        owner_type: 'agent',
        owner_id: 'bot-X',
        metadata: expect.objectContaining({
          team9Scope: { scope: 'agent', scopeId: 'bot-X', mountKey: 'home' },
        }),
      }),
    );

    // Insert payload mirrors the create-folder result.
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-1',
        scope: 'agent',
        scopeId: 'bot-X',
        mountKey: 'home',
        folderType: 'light',
        folder9FolderId: 'new-id',
      }),
    );

    expect(result.folder9FolderId).toBe('new-id');
    // Two selects: lookup-miss + re-select-after-insert.
    expect(selectMock).toHaveBeenCalledTimes(2);
  });

  it('handles race: insert conflict returns the winner via re-select', async () => {
    const { resolver, folder9, selectMock, insertMock } = buildHarness();
    // First lookup empty; after our (no-op) insert the re-select sees the
    // winner's row, NOT our just-created Folder9 folder id.
    selectMock
      .mockReturnValueOnce([])
      .mockReturnValueOnce([{ folder9FolderId: 'winner-id' }]);
    folder9.createFolder.mockResolvedValue({ id: 'loser-id' });
    insertMock.mockReturnValue({
      onConflictDoNothing: () => Promise.resolve(),
    });

    const result = await resolver.provisionFolderForMount({
      ...BASE_ARGS,
      scopeId: 'sess-B',
      mountKey: 'tmp',
    });

    // Re-select returned 'winner-id' (the row that beat us); we return that,
    // and 'loser-id' leaks for follow-up GC.
    expect(result.folder9FolderId).toBe('winner-id');
    expect(folder9.createFolder).toHaveBeenCalledTimes(1);
  });

  it('throws ServiceUnavailableException on Folder9 createFolder failure', async () => {
    const { resolver, folder9, selectMock, insertMock } = buildHarness();
    selectMock.mockReturnValue([]);
    folder9.createFolder.mockRejectedValue(
      new Folder9ApiError('folder9 down', 502, undefined),
    );

    await expect(
      resolver.provisionFolderForMount({
        ...BASE_ARGS,
        scopeId: 'sess-C',
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    // No insert attempted when Folder9 createFolder fails.
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('rethrows non-Folder9 errors from createFolder unchanged', async () => {
    const { resolver, folder9, selectMock, insertMock } = buildHarness();
    selectMock.mockReturnValue([]);
    const boom = new Error('unexpected boom');
    folder9.createFolder.mockRejectedValue(boom);

    await expect(
      resolver.provisionFolderForMount({
        ...BASE_ARGS,
        scopeId: 'sess-D',
      }),
    ).rejects.toBe(boom);

    expect(insertMock).not.toHaveBeenCalled();
  });

  it('throws ServiceUnavailableException when re-select finds no row (concurrent delete)', async () => {
    const { resolver, folder9, selectMock, insertMock } = buildHarness();
    // First lookup miss; re-select after insert ALSO empty — should not
    // happen in steady state but must surface as a 503-class failure rather
    // than crash with `undefined`.
    selectMock.mockReturnValueOnce([]).mockReturnValueOnce([]);
    folder9.createFolder.mockResolvedValue({ id: 'orphan-id' });
    insertMock.mockReturnValue({
      onConflictDoNothing: () => Promise.resolve(),
    });

    await expect(
      resolver.provisionFolderForMount({
        ...BASE_ARGS,
        scopeId: 'sess-E',
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

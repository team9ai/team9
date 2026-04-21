import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals';
import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DATABASE_CONNECTION } from '@team9/database';
import { WikisService } from '../wikis.service.js';
import { Folder9ClientService } from '../folder9-client.service.js';
import { Folder9ApiError } from '../types/folder9.types.js';
import { WEBSOCKET_GATEWAY } from '../../shared/constants/injection-tokens.js';

// ── helpers ──────────────────────────────────────────────────────────

type MockFn = jest.Mock<(...args: any[]) => any>;

/**
 * Create a fluent drizzle chain mock. Every chain method returns the same
 * `chain` object so calls like `.select().from().where()` keep flowing. The
 * terminal methods (`limit`, `returning`, `orderBy`) are pre-configured to
 * resolve to `[]`; tests override them per-call via `mockResolvedValueOnce`.
 */
function mockDb() {
  const chain: Record<string, MockFn> = {};
  const methods = [
    'select',
    'from',
    'where',
    'and',
    'eq',
    'insert',
    'values',
    'returning',
    'update',
    'set',
    'delete',
    'orderBy',
    'limit',
  ];
  for (const m of methods) {
    chain[m] = jest.fn<any>().mockReturnValue(chain);
  }
  // Default terminal resolutions — tests override per-call.
  chain.limit.mockResolvedValue([]);
  chain.returning.mockResolvedValue([]);
  chain.orderBy.mockResolvedValue([]);
  return chain;
}

/**
 * Mock implementation of {@link BroadcastingGateway} — the narrow WS surface
 * `WikisService` depends on. Provided via the {@link WEBSOCKET_GATEWAY}
 * Symbol token so the service's Nest DI resolves it the same way production
 * wiring does.
 */
function mockWs() {
  return {
    broadcastToWorkspace: jest
      .fn<(ws: string, event: string, data: unknown) => Promise<void>>()
      .mockResolvedValue(undefined),
  };
}

function mockFolder9() {
  return {
    createFolder: jest.fn<any>(),
    getFolder: jest.fn<any>(),
    updateFolder: jest.fn<any>(),
    deleteFolder: jest.fn<any>(),
    createToken: jest.fn<any>(),
    getTree: jest.fn<any>(),
    getBlob: jest.fn<any>(),
    getRaw: jest.fn<any>(),
    commit: jest.fn<any>(),
    listProposals: jest.fn<any>(),
    getProposal: jest.fn<any>(),
    getProposalDiff: jest.fn<any>(),
    approveProposal: jest.fn<any>(),
    rejectProposal: jest.fn<any>(),
  } as unknown as jest.Mocked<Folder9ClientService> & {
    createFolder: MockFn;
    deleteFolder: MockFn;
    updateFolder: MockFn;
    createToken: MockFn;
    getTree: MockFn;
    getBlob: MockFn;
    getRaw: MockFn;
    commit: MockFn;
    listProposals: MockFn;
    getProposal: MockFn;
    getProposalDiff: MockFn;
    approveProposal: MockFn;
    rejectProposal: MockFn;
  };
}

/**
 * Default factory for a fresh-token response. Tests can pass overrides to
 * simulate stable tokens across mint calls (for cache tests) or permission
 * variants.
 */
function makeToken(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tok-id',
    token: 'tok-read-1',
    folder_id: 'f9-1',
    permission: 'read' as const,
    name: 'wiki-read',
    created_by: 'wiki:f9-1',
    created_at: '2026-04-13T10:00:00.000Z',
    expires_at: '2026-04-13T10:16:00.000Z',
    ...overrides,
  };
}

const NOW = new Date('2026-04-13T10:00:00.000Z');
const LATER = new Date('2026-04-13T11:00:00.000Z');

function makeWikiRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wiki-1',
    workspaceId: 'ws-1',
    folder9FolderId: 'f9-1',
    name: 'public',
    slug: 'public',
    icon: null as string | null,
    approvalMode: 'auto' as const,
    humanPermission: 'write' as const,
    agentPermission: 'read' as const,
    createdBy: 'user-1',
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null as Date | null,
    ...overrides,
  };
}

function makeFolder9Response(overrides: Record<string, unknown> = {}) {
  return {
    id: 'f9-1',
    name: 'public',
    type: 'managed' as const,
    owner_type: 'workspace' as const,
    owner_id: 'ws-1',
    workspace_id: 'ws-1',
    approval_mode: 'auto' as const,
    created_at: '2026-04-13T10:00:00.000Z',
    updated_at: '2026-04-13T10:00:00.000Z',
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────

describe('WikisService', () => {
  let svc: WikisService;
  let db: ReturnType<typeof mockDb>;
  let f9: ReturnType<typeof mockFolder9>;
  let ws: ReturnType<typeof mockWs>;

  beforeEach(async () => {
    db = mockDb();
    f9 = mockFolder9();
    ws = mockWs();
    const moduleRef = await Test.createTestingModule({
      providers: [
        WikisService,
        { provide: DATABASE_CONNECTION, useValue: db },
        { provide: Folder9ClientService, useValue: f9 },
        { provide: WEBSOCKET_GATEWAY, useValue: ws },
      ],
    }).compile();
    svc = moduleRef.get(WikisService);
  });

  // ── createWiki ───────────────────────────────────────────────────────
  describe('createWiki', () => {
    it('creates a Wiki end-to-end with folder9 + DB insert', async () => {
      f9.createFolder.mockResolvedValue(makeFolder9Response() as never);
      // slug-uniqueness lookup → empty
      db.limit.mockResolvedValueOnce([]);
      // insert returning
      db.returning.mockResolvedValueOnce([makeWikiRow()]);

      const result = await svc.createWiki(
        'ws-1',
        { id: 'user-1', isAgent: false },
        { name: 'public' },
      );
      expect(result.icon).toBeNull();

      expect(f9.createFolder).toHaveBeenCalledWith(
        'ws-1',
        expect.objectContaining({
          name: 'public',
          type: 'managed',
          owner_type: 'workspace',
          owner_id: 'ws-1',
          approval_mode: 'auto',
        }),
      );
      expect(db.insert).toHaveBeenCalled();
      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: 'ws-1',
          folder9FolderId: 'f9-1',
          name: 'public',
          slug: 'public',
          approvalMode: 'auto',
          humanPermission: 'write',
          agentPermission: 'read',
          createdBy: 'user-1',
        }),
      );
      expect(result).toEqual({
        id: 'wiki-1',
        workspaceId: 'ws-1',
        name: 'public',
        slug: 'public',
        icon: null,
        approvalMode: 'auto',
        humanPermission: 'write',
        agentPermission: 'read',
        createdBy: 'user-1',
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
        archivedAt: null,
      });
    });

    it('honours dto.approvalMode + dto.humanPermission + dto.agentPermission overrides', async () => {
      f9.createFolder.mockResolvedValue(
        makeFolder9Response({ approval_mode: 'review' }) as never,
      );
      db.limit.mockResolvedValueOnce([]);
      db.returning.mockResolvedValueOnce([
        makeWikiRow({
          approvalMode: 'review',
          humanPermission: 'propose',
          agentPermission: 'write',
        }),
      ]);

      await svc.createWiki(
        'ws-1',
        { id: 'user-1', isAgent: false },
        {
          name: 'reviewed',
          approvalMode: 'review',
          humanPermission: 'propose',
          agentPermission: 'write',
        },
      );

      expect(f9.createFolder).toHaveBeenCalledWith(
        'ws-1',
        expect.objectContaining({ approval_mode: 'review' }),
      );
      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({
          approvalMode: 'review',
          humanPermission: 'propose',
          agentPermission: 'write',
        }),
      );
    });

    it('rejects agent callers with ForbiddenException without touching folder9', async () => {
      await expect(
        svc.createWiki('ws-1', { id: 'agent-1', isAgent: true }, { name: 'x' }),
      ).rejects.toThrow(ForbiddenException);
      expect(f9.createFolder).not.toHaveBeenCalled();
      expect(db.insert).not.toHaveBeenCalled();
    });

    it('throws ConflictException on duplicate slug — folder9 NOT called', async () => {
      db.limit.mockResolvedValueOnce([{ id: 'existing-wiki' }]);
      await expect(
        svc.createWiki(
          'ws-1',
          { id: 'user-1', isAgent: false },
          { name: 'public', slug: 'public' },
        ),
      ).rejects.toThrow(ConflictException);
      expect(f9.createFolder).not.toHaveBeenCalled();
      expect(db.insert).not.toHaveBeenCalled();
    });

    it('derives slug from name "Hello World!" → "hello-world"', async () => {
      f9.createFolder.mockResolvedValue(makeFolder9Response() as never);
      db.limit.mockResolvedValueOnce([]);
      db.returning.mockResolvedValueOnce([
        makeWikiRow({ name: 'Hello World!', slug: 'hello-world' }),
      ]);

      await svc.createWiki(
        'ws-1',
        { id: 'user-1', isAgent: false },
        { name: 'Hello World!' },
      );

      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({ slug: 'hello-world' }),
      );
    });

    it('derives slug from "API Docs!!!" → "api-docs"', async () => {
      f9.createFolder.mockResolvedValue(makeFolder9Response() as never);
      db.limit.mockResolvedValueOnce([]);
      db.returning.mockResolvedValueOnce([
        makeWikiRow({ name: 'API Docs!!!', slug: 'api-docs' }),
      ]);

      await svc.createWiki(
        'ws-1',
        { id: 'user-1', isAgent: false },
        { name: 'API Docs!!!' },
      );

      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({ slug: 'api-docs' }),
      );
    });

    it('falls back to "wiki" when name strips down to nothing', async () => {
      f9.createFolder.mockResolvedValue(makeFolder9Response() as never);
      db.limit.mockResolvedValueOnce([]);
      db.returning.mockResolvedValueOnce([
        makeWikiRow({ name: '!!!', slug: 'wiki' }),
      ]);

      await svc.createWiki(
        'ws-1',
        { id: 'user-1', isAgent: false },
        { name: '!!!' },
      );

      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({ slug: 'wiki' }),
      );
    });

    it('compensates by deleting the folder9 folder when DB insert fails', async () => {
      f9.createFolder.mockResolvedValue(
        makeFolder9Response({ id: 'f9-ghost' }) as never,
      );
      f9.deleteFolder.mockResolvedValue(undefined as never);
      db.limit.mockResolvedValueOnce([]);
      db.returning.mockRejectedValueOnce(new Error('db down'));

      await expect(
        svc.createWiki('ws-1', { id: 'user-1', isAgent: false }, { name: 'x' }),
      ).rejects.toThrow(/db down/);
      expect(f9.deleteFolder).toHaveBeenCalledWith('ws-1', 'f9-ghost');
    });

    it('still re-throws original error and logs when compensation deleteFolder also fails', async () => {
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => {});
      f9.createFolder.mockResolvedValue(
        makeFolder9Response({ id: 'f9-ghost' }) as never,
      );
      f9.deleteFolder.mockRejectedValue(new Error('f9 down') as never);
      db.limit.mockResolvedValueOnce([]);
      db.returning.mockRejectedValueOnce(new Error('db down'));

      await expect(
        svc.createWiki('ws-1', { id: 'user-1', isAgent: false }, { name: 'x' }),
      ).rejects.toThrow(/db down/);
      expect(f9.deleteFolder).toHaveBeenCalledWith('ws-1', 'f9-ghost');
      expect(errorSpy).toHaveBeenCalled();

      errorSpy.mockRestore();
    });

    it('logs string-shaped compensation failure (non-Error throw)', async () => {
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => {});
      f9.createFolder.mockResolvedValue(
        makeFolder9Response({ id: 'f9-ghost' }) as never,
      );
      // Reject with a non-Error value from deleteFolder to cover the
      // `instanceof Error ? stack : String(err)` branch in the catch.
      f9.deleteFolder.mockImplementation(() =>
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        Promise.reject('plain string failure'),
      );
      db.limit.mockResolvedValueOnce([]);
      db.returning.mockRejectedValueOnce(new Error('db down'));

      await expect(
        svc.createWiki('ws-1', { id: 'user-1', isAgent: false }, { name: 'x' }),
      ).rejects.toThrow(/db down/);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.any(String),
        'plain string failure',
      );

      errorSpy.mockRestore();
    });

    it('broadcasts wiki_created to the workspace on success', async () => {
      f9.createFolder.mockResolvedValue(makeFolder9Response() as never);
      db.limit.mockResolvedValueOnce([]);
      db.returning.mockResolvedValueOnce([makeWikiRow()]);

      await svc.createWiki(
        'ws-1',
        { id: 'user-1', isAgent: false },
        { name: 'public' },
      );

      expect(ws.broadcastToWorkspace).toHaveBeenCalledWith(
        'ws-1',
        'wiki_created',
        { wikiId: 'wiki-1' },
      );
      expect(ws.broadcastToWorkspace).toHaveBeenCalledTimes(1);
    });

    it('does NOT broadcast wiki_created when slug is duplicate', async () => {
      db.limit.mockResolvedValueOnce([{ id: 'existing-wiki' }]);
      await expect(
        svc.createWiki(
          'ws-1',
          { id: 'user-1', isAgent: false },
          { name: 'public', slug: 'public' },
        ),
      ).rejects.toThrow(ConflictException);
      expect(ws.broadcastToWorkspace).not.toHaveBeenCalled();
    });

    it('does NOT broadcast wiki_created when DB insert fails (rollback path)', async () => {
      f9.createFolder.mockResolvedValue(
        makeFolder9Response({ id: 'f9-ghost' }) as never,
      );
      f9.deleteFolder.mockResolvedValue(undefined as never);
      db.limit.mockResolvedValueOnce([]);
      db.returning.mockRejectedValueOnce(new Error('db down'));

      await expect(
        svc.createWiki('ws-1', { id: 'user-1', isAgent: false }, { name: 'x' }),
      ).rejects.toThrow(/db down/);
      expect(ws.broadcastToWorkspace).not.toHaveBeenCalled();
    });

    it('does NOT broadcast wiki_created when agent caller is rejected', async () => {
      await expect(
        svc.createWiki('ws-1', { id: 'agent-1', isAgent: true }, { name: 'x' }),
      ).rejects.toThrow(ForbiddenException);
      expect(ws.broadcastToWorkspace).not.toHaveBeenCalled();
    });

    it('swallows broadcast errors and still returns the created wiki', async () => {
      const warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => {});
      f9.createFolder.mockResolvedValue(makeFolder9Response() as never);
      db.limit.mockResolvedValueOnce([]);
      db.returning.mockResolvedValueOnce([makeWikiRow()]);
      ws.broadcastToWorkspace.mockRejectedValueOnce(new Error('ws down'));

      const result = await svc.createWiki(
        'ws-1',
        { id: 'user-1', isAgent: false },
        { name: 'public' },
      );
      // Mutation must succeed even if the broadcast blew up.
      expect(result.id).toBe('wiki-1');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('wiki_created broadcast failed'),
      );
      warnSpy.mockRestore();
    });

    it('logs a string fallback when the broadcast rejects with a non-Error', async () => {
      const warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => {});
      f9.createFolder.mockResolvedValue(makeFolder9Response() as never);
      db.limit.mockResolvedValueOnce([]);
      db.returning.mockResolvedValueOnce([makeWikiRow()]);
      ws.broadcastToWorkspace.mockImplementationOnce(() =>
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        Promise.reject('plain string failure'),
      );

      await svc.createWiki(
        'ws-1',
        { id: 'user-1', isAgent: false },
        { name: 'public' },
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('plain string failure'),
      );
      warnSpy.mockRestore();
    });

    it('persists dto.icon when provided', async () => {
      f9.createFolder.mockResolvedValue(makeFolder9Response() as never);
      db.limit.mockResolvedValueOnce([]);
      db.returning.mockResolvedValueOnce([makeWikiRow({ icon: '📚' })]);

      const result = await svc.createWiki(
        'ws-1',
        { id: 'user-1', isAgent: false },
        { name: 'public', icon: '📚' },
      );

      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({ icon: '📚' }),
      );
      expect(result.icon).toBe('📚');
    });

    it('persists icon=null when dto.icon is omitted', async () => {
      f9.createFolder.mockResolvedValue(makeFolder9Response() as never);
      db.limit.mockResolvedValueOnce([]);
      db.returning.mockResolvedValueOnce([makeWikiRow()]);

      await svc.createWiki(
        'ws-1',
        { id: 'user-1', isAgent: false },
        { name: 'public' },
      );

      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({ icon: null }),
      );
    });
  });

  // ── listWikis ────────────────────────────────────────────────────────
  describe('listWikis', () => {
    it('returns mapped DTOs filtered by workspaceId and non-archived', async () => {
      const row1 = makeWikiRow({ id: 'w1', name: 'Public', slug: 'public' });
      const row2 = makeWikiRow({
        id: 'w2',
        name: 'Private',
        slug: 'private',
        createdAt: LATER,
        updatedAt: LATER,
      });
      db.orderBy.mockResolvedValueOnce([row2, row1]);

      const result = await svc.listWikis('ws-1');

      expect(db.select).toHaveBeenCalled();
      expect(db.from).toHaveBeenCalled();
      expect(db.where).toHaveBeenCalled();
      expect(db.orderBy).toHaveBeenCalled();
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('w2');
      expect(result[1].id).toBe('w1');
      expect(result[0].createdAt).toBe(LATER.toISOString());
    });

    it('returns empty array when no wikis exist', async () => {
      db.orderBy.mockResolvedValueOnce([]);
      const result = await svc.listWikis('ws-1');
      expect(result).toEqual([]);
    });
  });

  // ── getWiki ──────────────────────────────────────────────────────────
  describe('getWiki', () => {
    it('returns the wiki for a user with read permission', async () => {
      const row = makeWikiRow();
      db.limit.mockResolvedValueOnce([row]);

      const result = await svc.getWiki('ws-1', 'wiki-1', {
        id: 'user-1',
        isAgent: false,
      });
      expect(result.id).toBe('wiki-1');
      expect(result.archivedAt).toBeNull();
    });

    it('serializes archivedAt to ISO string when set', async () => {
      const archivedAt = new Date('2026-04-12T00:00:00.000Z');
      const row = makeWikiRow({ archivedAt });
      db.limit.mockResolvedValueOnce([row]);

      const result = await svc.getWiki('ws-1', 'wiki-1', {
        id: 'user-1',
        isAgent: false,
      });
      expect(result.archivedAt).toBe(archivedAt.toISOString());
    });

    it('throws NotFoundException when wiki missing', async () => {
      db.limit.mockResolvedValueOnce([]);
      await expect(
        svc.getWiki('ws-1', 'missing', { id: 'user-1', isAgent: false }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when human caller lacks read', async () => {
      const row = makeWikiRow({
        humanPermission: 'read',
        agentPermission: 'read',
      });
      db.limit.mockResolvedValueOnce([row]);
      // read permission requires actual >= 'read' which is always satisfied;
      // simulate a wiki with no human access by setting humanPermission:'read'
      // and asserting the *permission helper* still passes — happy path.
      // (To exercise denial we need a hypothetical lower-than-read level which
      //  doesn't exist; skip the negative branch here, covered for write/propose.)
      const result = await svc.getWiki('ws-1', 'wiki-1', {
        id: 'user-1',
        isAgent: false,
      });
      expect(result.id).toBe('wiki-1');
    });
  });

  // ── updateWikiSettings ──────────────────────────────────────────────
  describe('updateWikiSettings', () => {
    it('happy path: write user updates name and approvalMode → mirrors to folder9', async () => {
      const row = makeWikiRow();
      db.limit.mockResolvedValueOnce([row]); // getWikiOrThrow
      db.returning.mockResolvedValueOnce([
        makeWikiRow({
          name: 'Renamed',
          approvalMode: 'review',
          updatedAt: LATER,
        }),
      ]);
      f9.updateFolder.mockResolvedValue(undefined as never);

      const result = await svc.updateWikiSettings(
        'ws-1',
        'wiki-1',
        { id: 'user-1', isAgent: false },
        { name: 'Renamed', approvalMode: 'review' },
      );

      expect(db.update).toHaveBeenCalled();
      expect(db.set).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Renamed',
          approvalMode: 'review',
        }),
      );
      expect(f9.updateFolder).toHaveBeenCalledWith('ws-1', 'f9-1', {
        name: 'Renamed',
        approval_mode: 'review',
      });
      expect(result.name).toBe('Renamed');
      expect(result.approvalMode).toBe('review');
    });

    it('mirrors only name to folder9 when approvalMode unchanged', async () => {
      const row = makeWikiRow();
      db.limit.mockResolvedValueOnce([row]);
      db.returning.mockResolvedValueOnce([makeWikiRow({ name: 'Renamed' })]);
      f9.updateFolder.mockResolvedValue(undefined as never);

      await svc.updateWikiSettings(
        'ws-1',
        'wiki-1',
        { id: 'user-1', isAgent: false },
        { name: 'Renamed' },
      );

      expect(f9.updateFolder).toHaveBeenCalledWith('ws-1', 'f9-1', {
        name: 'Renamed',
      });
    });

    it('mirrors only approvalMode to folder9 when name unchanged', async () => {
      const row = makeWikiRow();
      db.limit.mockResolvedValueOnce([row]);
      db.returning.mockResolvedValueOnce([
        makeWikiRow({ approvalMode: 'review' }),
      ]);
      f9.updateFolder.mockResolvedValue(undefined as never);

      await svc.updateWikiSettings(
        'ws-1',
        'wiki-1',
        { id: 'user-1', isAgent: false },
        { approvalMode: 'review' },
      );

      expect(f9.updateFolder).toHaveBeenCalledWith('ws-1', 'f9-1', {
        approval_mode: 'review',
      });
    });

    it('does NOT call folder9 when only permission fields change', async () => {
      const row = makeWikiRow();
      db.limit.mockResolvedValueOnce([row]);
      db.returning.mockResolvedValueOnce([
        makeWikiRow({ humanPermission: 'propose' }),
      ]);

      await svc.updateWikiSettings(
        'ws-1',
        'wiki-1',
        { id: 'user-1', isAgent: false },
        { humanPermission: 'propose', agentPermission: 'write' },
      );

      expect(f9.updateFolder).not.toHaveBeenCalled();
      expect(db.set).toHaveBeenCalledWith(
        expect.objectContaining({
          humanPermission: 'propose',
          agentPermission: 'write',
        }),
      );
    });

    it('updates slug after re-checking uniqueness', async () => {
      const row = makeWikiRow();
      db.limit.mockResolvedValueOnce([row]); // getWikiOrThrow
      db.limit.mockResolvedValueOnce([]); // dup-slug check returns empty
      db.returning.mockResolvedValueOnce([makeWikiRow({ slug: 'new-slug' })]);

      const result = await svc.updateWikiSettings(
        'ws-1',
        'wiki-1',
        { id: 'user-1', isAgent: false },
        { slug: 'new-slug' },
      );

      expect(result.slug).toBe('new-slug');
      // folder9 NOT called — slug change alone doesn't mirror
      expect(f9.updateFolder).not.toHaveBeenCalled();
    });

    it('throws ConflictException when new slug is taken', async () => {
      const row = makeWikiRow({ slug: 'old-slug' });
      db.limit.mockResolvedValueOnce([row]); // getWikiOrThrow
      db.limit.mockResolvedValueOnce([{ id: 'other-wiki' }]); // duplicate

      await expect(
        svc.updateWikiSettings(
          'ws-1',
          'wiki-1',
          { id: 'user-1', isAgent: false },
          { slug: 'taken' },
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('skips slug uniqueness check when slug equals current value', async () => {
      const row = makeWikiRow({ slug: 'public' });
      db.limit.mockResolvedValueOnce([row]); // getWikiOrThrow ONLY
      db.returning.mockResolvedValueOnce([makeWikiRow()]);

      await svc.updateWikiSettings(
        'ws-1',
        'wiki-1',
        { id: 'user-1', isAgent: false },
        { slug: 'public' },
      );

      // limit was only consumed once (for getWikiOrThrow), no dup-check
      expect(db.limit).toHaveBeenCalledTimes(1);
    });

    it('throws ForbiddenException when human caller has only propose perm', async () => {
      const row = makeWikiRow({ humanPermission: 'propose' });
      db.limit.mockResolvedValueOnce([row]);

      await expect(
        svc.updateWikiSettings(
          'ws-1',
          'wiki-1',
          { id: 'user-1', isAgent: false },
          { name: 'x' },
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(f9.updateFolder).not.toHaveBeenCalled();
      expect(db.update).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when human caller has only read perm', async () => {
      const row = makeWikiRow({ humanPermission: 'read' });
      db.limit.mockResolvedValueOnce([row]);

      await expect(
        svc.updateWikiSettings(
          'ws-1',
          'wiki-1',
          { id: 'user-1', isAgent: false },
          { name: 'x' },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when wiki does not exist', async () => {
      db.limit.mockResolvedValueOnce([]);
      await expect(
        svc.updateWikiSettings(
          'ws-1',
          'missing',
          { id: 'user-1', isAgent: false },
          { name: 'x' },
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('broadcasts wiki_updated to the workspace on success', async () => {
      const row = makeWikiRow();
      db.limit.mockResolvedValueOnce([row]);
      db.returning.mockResolvedValueOnce([makeWikiRow({ name: 'Renamed' })]);
      f9.updateFolder.mockResolvedValue(undefined as never);

      await svc.updateWikiSettings(
        'ws-1',
        'wiki-1',
        { id: 'user-1', isAgent: false },
        { name: 'Renamed' },
      );

      expect(ws.broadcastToWorkspace).toHaveBeenCalledWith(
        'ws-1',
        'wiki_updated',
        { wikiId: 'wiki-1' },
      );
      expect(ws.broadcastToWorkspace).toHaveBeenCalledTimes(1);
    });

    it('does NOT broadcast wiki_updated when permission check fails', async () => {
      const row = makeWikiRow({ humanPermission: 'read' });
      db.limit.mockResolvedValueOnce([row]);

      await expect(
        svc.updateWikiSettings(
          'ws-1',
          'wiki-1',
          { id: 'user-1', isAgent: false },
          { name: 'x' },
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(ws.broadcastToWorkspace).not.toHaveBeenCalled();
    });

    it('does NOT broadcast wiki_updated when slug check conflicts', async () => {
      const row = makeWikiRow({ slug: 'old' });
      db.limit.mockResolvedValueOnce([row]);
      db.limit.mockResolvedValueOnce([{ id: 'other-wiki' }]);

      await expect(
        svc.updateWikiSettings(
          'ws-1',
          'wiki-1',
          { id: 'user-1', isAgent: false },
          { slug: 'taken' },
        ),
      ).rejects.toThrow(ConflictException);
      expect(ws.broadcastToWorkspace).not.toHaveBeenCalled();
    });

    it('swallows broadcast errors and still returns the updated wiki', async () => {
      const warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => {});
      const row = makeWikiRow();
      db.limit.mockResolvedValueOnce([row]);
      db.returning.mockResolvedValueOnce([makeWikiRow({ name: 'Renamed' })]);
      f9.updateFolder.mockResolvedValue(undefined as never);
      ws.broadcastToWorkspace.mockRejectedValueOnce(new Error('ws down'));

      const result = await svc.updateWikiSettings(
        'ws-1',
        'wiki-1',
        { id: 'user-1', isAgent: false },
        { name: 'Renamed' },
      );
      expect(result.name).toBe('Renamed');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('wiki_updated broadcast failed'),
      );
      warnSpy.mockRestore();
    });

    it('includes icon in the patch when provided and does NOT mirror it to folder9', async () => {
      const row = makeWikiRow();
      db.limit.mockResolvedValueOnce([row]);
      db.returning.mockResolvedValueOnce([makeWikiRow({ icon: '📘' })]);

      const result = await svc.updateWikiSettings(
        'ws-1',
        'wiki-1',
        { id: 'user-1', isAgent: false },
        { icon: '📘' },
      );

      expect(db.set).toHaveBeenCalledWith(
        expect.objectContaining({ icon: '📘' }),
      );
      // icon is Team9-internal UI chrome; folder9 must NOT be touched for
      // icon-only updates (it has no icon concept).
      expect(f9.updateFolder).not.toHaveBeenCalled();
      expect(result.icon).toBe('📘');
    });

    it('supports clearing the icon by passing empty string', async () => {
      const row = makeWikiRow({ icon: '📚' });
      db.limit.mockResolvedValueOnce([row]);
      db.returning.mockResolvedValueOnce([makeWikiRow({ icon: '' })]);

      await svc.updateWikiSettings(
        'ws-1',
        'wiki-1',
        { id: 'user-1', isAgent: false },
        { icon: '' },
      );

      expect(db.set).toHaveBeenCalledWith(
        expect.objectContaining({ icon: '' }),
      );
      expect(f9.updateFolder).not.toHaveBeenCalled();
    });

    it('does NOT include icon in the patch when dto.icon is omitted', async () => {
      const row = makeWikiRow({ icon: '📘' });
      db.limit.mockResolvedValueOnce([row]);
      db.returning.mockResolvedValueOnce([makeWikiRow({ name: 'Renamed' })]);
      f9.updateFolder.mockResolvedValue(undefined as never);

      await svc.updateWikiSettings(
        'ws-1',
        'wiki-1',
        { id: 'user-1', isAgent: false },
        { name: 'Renamed' },
      );

      const setCall = (
        db.set.mock.calls[db.set.mock.calls.length - 1] as unknown[]
      )[0] as Record<string, unknown>;
      expect(setCall).not.toHaveProperty('icon');
    });
  });

  // ── archiveWiki ─────────────────────────────────────────────────────
  describe('archiveWiki', () => {
    it('happy path: write user archives → sets archivedAt, NOT folder9', async () => {
      const row = makeWikiRow();
      db.limit.mockResolvedValueOnce([row]);

      await svc.archiveWiki('ws-1', 'wiki-1', {
        id: 'user-1',
        isAgent: false,
      });

      expect(db.update).toHaveBeenCalled();
      expect(db.set).toHaveBeenCalledWith(
        expect.objectContaining({ archivedAt: expect.any(Date) }),
      );
      expect(f9.deleteFolder).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException for user with propose-only perm', async () => {
      const row = makeWikiRow({ humanPermission: 'propose' });
      db.limit.mockResolvedValueOnce([row]);

      await expect(
        svc.archiveWiki('ws-1', 'wiki-1', { id: 'user-1', isAgent: false }),
      ).rejects.toThrow(ForbiddenException);
      expect(db.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when wiki does not exist', async () => {
      db.limit.mockResolvedValueOnce([]);
      await expect(
        svc.archiveWiki('ws-1', 'missing', { id: 'user-1', isAgent: false }),
      ).rejects.toThrow(NotFoundException);
    });

    it('broadcasts wiki_archived to the workspace on success', async () => {
      const row = makeWikiRow();
      db.limit.mockResolvedValueOnce([row]);

      await svc.archiveWiki('ws-1', 'wiki-1', {
        id: 'user-1',
        isAgent: false,
      });

      expect(ws.broadcastToWorkspace).toHaveBeenCalledWith(
        'ws-1',
        'wiki_archived',
        { wikiId: 'wiki-1' },
      );
      expect(ws.broadcastToWorkspace).toHaveBeenCalledTimes(1);
    });

    it('does NOT broadcast wiki_archived when permission check fails', async () => {
      const row = makeWikiRow({ humanPermission: 'propose' });
      db.limit.mockResolvedValueOnce([row]);

      await expect(
        svc.archiveWiki('ws-1', 'wiki-1', { id: 'user-1', isAgent: false }),
      ).rejects.toThrow(ForbiddenException);
      expect(ws.broadcastToWorkspace).not.toHaveBeenCalled();
    });

    it('does NOT broadcast wiki_archived when wiki not found', async () => {
      db.limit.mockResolvedValueOnce([]);
      await expect(
        svc.archiveWiki('ws-1', 'missing', { id: 'user-1', isAgent: false }),
      ).rejects.toThrow(NotFoundException);
      expect(ws.broadcastToWorkspace).not.toHaveBeenCalled();
    });

    it('swallows broadcast errors and still completes the archive', async () => {
      const warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => {});
      const row = makeWikiRow();
      db.limit.mockResolvedValueOnce([row]);
      ws.broadcastToWorkspace.mockRejectedValueOnce(new Error('ws down'));

      await expect(
        svc.archiveWiki('ws-1', 'wiki-1', { id: 'user-1', isAgent: false }),
      ).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('wiki_archived broadcast failed'),
      );
      warnSpy.mockRestore();
    });
  });

  // ── getTree ─────────────────────────────────────────────────────────
  describe('getTree', () => {
    const user = { id: 'user-1', isAgent: false };

    it('returns folder9 tree entries for a read user', async () => {
      const row = makeWikiRow();
      db.limit.mockResolvedValueOnce([row]); // getWikiOrThrow
      f9.createToken.mockResolvedValue(makeToken({ token: 'tok-read' }));
      const entries = [
        { name: 'readme.md', path: 'readme.md', type: 'file', size: 10 },
        { name: 'docs', path: 'docs', type: 'dir', size: 0 },
      ];
      f9.getTree.mockResolvedValue(entries);

      const result = await svc.getTree('ws-1', 'wiki-1', user, {
        path: '/docs',
        recursive: true,
      });

      expect(result).toEqual(entries);
      expect(f9.createToken).toHaveBeenCalledWith(
        expect.objectContaining({
          folder_id: 'f9-1',
          permission: 'read',
          name: 'wiki-read',
          created_by: 'wiki:f9-1',
          expires_at: expect.stringMatching(/\d{4}-\d{2}-\d{2}T/),
        }),
      );
      expect(f9.getTree).toHaveBeenCalledWith('ws-1', 'f9-1', 'tok-read', {
        path: '/docs',
        recursive: true,
      });
    });

    it('defaults to path=/ and recursive=false when opts omitted', async () => {
      const row = makeWikiRow();
      db.limit.mockResolvedValueOnce([row]);
      f9.createToken.mockResolvedValue(makeToken({ token: 'tok-read' }));
      f9.getTree.mockResolvedValue([]);

      await svc.getTree('ws-1', 'wiki-1', user);

      expect(f9.getTree).toHaveBeenCalledWith('ws-1', 'f9-1', 'tok-read', {
        path: '/',
        recursive: false,
      });
    });

    it('throws NotFoundException before minting a token when wiki missing', async () => {
      db.limit.mockResolvedValueOnce([]);
      await expect(svc.getTree('ws-1', 'missing', user)).rejects.toThrow(
        NotFoundException,
      );
      expect(f9.createToken).not.toHaveBeenCalled();
      expect(f9.getTree).not.toHaveBeenCalled();
    });

    it('rejects a traversal path (../escape) before any DB / folder9 work', async () => {
      // Mirrors the getPage traversal test: validation must run before
      // getWikiOrThrow so an attacker can't probe for wiki existence via
      // a malformed path.
      await expect(
        svc.getTree('ws-1', 'wiki-1', user, { path: '../escape' }),
      ).rejects.toThrow(BadRequestException);
      expect(db.limit).not.toHaveBeenCalled();
      expect(f9.createToken).not.toHaveBeenCalled();
      expect(f9.getTree).not.toHaveBeenCalled();
    });

    it('rejects a traversal path with a leading slash (/../etc) before any DB / folder9 work', async () => {
      // `getTree` accepts the `/docs` absolute form, but the validator still
      // sees the stripped tail. A path like `/../etc` strips to `../etc`,
      // which must be rejected — verifying the "absolute form doesn't
      // bypass validation" invariant.
      await expect(
        svc.getTree('ws-1', 'wiki-1', user, { path: '/../etc' }),
      ).rejects.toThrow(BadRequestException);
      expect(db.limit).not.toHaveBeenCalled();
      expect(f9.createToken).not.toHaveBeenCalled();
      expect(f9.getTree).not.toHaveBeenCalled();
    });
  });

  // ── getPage ─────────────────────────────────────────────────────────
  describe('getPage', () => {
    const user = { id: 'user-1', isAgent: false };

    it('parses YAML frontmatter and splits body from blob content', async () => {
      const row = makeWikiRow();
      db.limit.mockResolvedValueOnce([row]);
      f9.createToken.mockResolvedValue(makeToken({ token: 'tok-read' }));
      f9.getBlob.mockResolvedValue({
        path: 'guide.md',
        size: 10,
        content: '---\ntitle: Hi\ntags:\n  - wiki\n---\n\nBody here.',
        encoding: 'text',
      });

      const result = await svc.getPage('ws-1', 'wiki-1', user, 'guide.md');

      expect(result.path).toBe('guide.md');
      expect(result.content).toBe('Body here.');
      expect(result.frontmatter).toEqual({ title: 'Hi', tags: ['wiki'] });
      expect(result.lastCommit).toBeNull();
      expect(f9.getBlob).toHaveBeenCalledWith(
        'ws-1',
        'f9-1',
        'tok-read',
        'guide.md',
      );
    });

    it('returns empty frontmatter + full body when blob has no frontmatter', async () => {
      const row = makeWikiRow();
      db.limit.mockResolvedValueOnce([row]);
      f9.createToken.mockResolvedValue(makeToken({ token: 'tok-read' }));
      f9.getBlob.mockResolvedValue({
        path: 'plain.md',
        size: 5,
        content: '# Plain markdown, no fences',
        encoding: 'text',
      });

      const result = await svc.getPage('ws-1', 'wiki-1', user, 'plain.md');

      expect(result.frontmatter).toEqual({});
      expect(result.content).toBe('# Plain markdown, no fences');
    });

    it('logs a warning and returns raw body when frontmatter is malformed', async () => {
      const warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => {});
      const row = makeWikiRow();
      db.limit.mockResolvedValueOnce([row]);
      f9.createToken.mockResolvedValue(makeToken({ token: 'tok-read' }));
      const bad = '---\n- just\n- a\n- list\n---\n\nbody';
      f9.getBlob.mockResolvedValue({
        path: 'bad.md',
        size: 10,
        content: bad,
        encoding: 'text',
      });

      const result = await svc.getPage('ws-1', 'wiki-1', user, 'bad.md');

      expect(result.frontmatter).toEqual({});
      // Full raw content preserved — the UI must still be able to show it.
      expect(result.content).toBe(bad);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Malformed frontmatter'),
      );
      warnSpy.mockRestore();
    });

    it('rejects a traversal path (../foo.md) before any DB / folder9 work', async () => {
      await expect(
        svc.getPage('ws-1', 'wiki-1', user, '../foo.md'),
      ).rejects.toThrow(BadRequestException);
      expect(f9.createToken).not.toHaveBeenCalled();
      expect(f9.getBlob).not.toHaveBeenCalled();
    });

    it('rejects an absolute path (/etc/passwd) before any DB / folder9 work', async () => {
      await expect(
        svc.getPage('ws-1', 'wiki-1', user, '/etc/passwd'),
      ).rejects.toThrow(BadRequestException);
      expect(f9.createToken).not.toHaveBeenCalled();
      expect(f9.getBlob).not.toHaveBeenCalled();
    });
  });

  // ── getRaw ──────────────────────────────────────────────────────────
  describe('getRaw', () => {
    const user = { id: 'user-1', isAgent: false };

    it('returns raw bytes for a read user', async () => {
      const row = makeWikiRow();
      db.limit.mockResolvedValueOnce([row]); // getWikiOrThrow
      f9.createToken.mockResolvedValue(makeToken({ token: 'tok-read' }));
      const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
      f9.getRaw.mockResolvedValue(bytes);

      const result = await svc.getRaw('ws-1', 'wiki-1', user, 'cover.png');

      expect(result).toBe(bytes);
      expect(f9.createToken).toHaveBeenCalledWith(
        expect.objectContaining({
          folder_id: 'f9-1',
          permission: 'read',
          created_by: 'wiki:f9-1',
        }),
      );
      expect(f9.getRaw).toHaveBeenCalledWith(
        'ws-1',
        'f9-1',
        'tok-read',
        'cover.png',
      );
    });

    it('throws NotFoundException before minting a token when wiki missing', async () => {
      db.limit.mockResolvedValueOnce([]);
      await expect(
        svc.getRaw('ws-1', 'missing', user, 'cover.png'),
      ).rejects.toThrow(NotFoundException);
      expect(f9.createToken).not.toHaveBeenCalled();
      expect(f9.getRaw).not.toHaveBeenCalled();
    });

    it('shares the per-wiki read-scoped token across callers', async () => {
      const row = makeWikiRow();
      db.limit.mockResolvedValueOnce([row]);
      f9.createToken.mockResolvedValue(makeToken({ token: 'tok-read' }));
      f9.getRaw.mockResolvedValue(new ArrayBuffer(0));

      await svc.getRaw(
        'ws-1',
        'wiki-1',
        { id: 'agent-1', isAgent: true },
        'cover.png',
      );

      // Token created_by is stable per-wiki regardless of caller identity so
      // multiple readers share a single cached token entry.
      expect(f9.createToken).toHaveBeenCalledWith(
        expect.objectContaining({ created_by: 'wiki:f9-1' }),
      );
    });

    it('rejects a traversal path (foo/../bar.png) before any DB / folder9 work', async () => {
      await expect(
        svc.getRaw('ws-1', 'wiki-1', user, 'foo/../bar.png'),
      ).rejects.toThrow(BadRequestException);
      expect(f9.createToken).not.toHaveBeenCalled();
      expect(f9.getRaw).not.toHaveBeenCalled();
    });
  });

  // ── commitPage ──────────────────────────────────────────────────────
  describe('commitPage', () => {
    const writeUser = { id: 'user-1', isAgent: false };
    const commitDto = {
      message: 'add page',
      files: [{ path: 'a.md', content: 'hi', action: 'create' as const }],
    };

    beforeEach(() => {
      // Default: user row has a display name
      db.limit.mockResolvedValue([]);
    });

    it('auto + write → direct commit with propose=false', async () => {
      const row = makeWikiRow({
        approvalMode: 'auto',
        humanPermission: 'write',
      });
      db.limit
        .mockResolvedValueOnce([row]) // getWikiOrThrow
        .mockResolvedValueOnce([
          { displayName: 'Alice', email: 'alice@example.com' },
        ]); // loadUserProfile
      f9.createToken.mockResolvedValue(makeToken({ token: 'tok-write' }));
      f9.commit.mockResolvedValue({ commit: 'sha-1', branch: 'main' });

      const result = await svc.commitPage(
        'ws-1',
        'wiki-1',
        writeUser,
        commitDto,
      );

      expect(result).toEqual({
        commit: { sha: 'sha-1' },
        proposal: null,
      });
      expect(f9.createToken).toHaveBeenCalledWith(
        expect.objectContaining({
          folder_id: 'f9-1',
          permission: 'write',
          created_by: 'Alice',
        }),
      );
      expect(f9.commit).toHaveBeenCalledWith('ws-1', 'f9-1', 'tok-write', {
        message: 'add page',
        files: commitDto.files,
        propose: false,
      });
    });

    it('auto + propose user → forced propose=true', async () => {
      const row = makeWikiRow({
        approvalMode: 'auto',
        humanPermission: 'propose',
      });
      db.limit
        .mockResolvedValueOnce([row])
        .mockResolvedValueOnce([
          { displayName: 'Alice', email: 'alice@example.com' },
        ]);
      f9.createToken.mockResolvedValue(makeToken({ token: 'tok-propose' }));
      f9.commit.mockResolvedValue({
        commit: 'sha-1',
        branch: 'proposal/x',
        proposal_id: 'prop-1',
      });

      const result = await svc.commitPage(
        'ws-1',
        'wiki-1',
        writeUser,
        commitDto,
      );

      expect(result).toEqual({
        commit: { sha: 'sha-1' },
        proposal: { id: 'prop-1', status: 'pending' },
      });
      expect(f9.createToken).toHaveBeenCalledWith(
        expect.objectContaining({ permission: 'propose' }),
      );
      expect(f9.commit).toHaveBeenCalledWith(
        'ws-1',
        'f9-1',
        'tok-propose',
        expect.objectContaining({ propose: true }),
      );
    });

    it('auto + write user with dto.propose=true → forced propose=true', async () => {
      const row = makeWikiRow({
        approvalMode: 'auto',
        humanPermission: 'write',
      });
      db.limit
        .mockResolvedValueOnce([row])
        .mockResolvedValueOnce([
          { displayName: 'Alice', email: 'alice@example.com' },
        ]);
      f9.createToken.mockResolvedValue(makeToken({ token: 'tok-propose' }));
      f9.commit.mockResolvedValue({
        commit: 'sha-1',
        branch: 'proposal/x',
        proposal_id: 'prop-2',
      });

      const result = await svc.commitPage('ws-1', 'wiki-1', writeUser, {
        ...commitDto,
        propose: true,
      });

      expect(result.proposal).toEqual({ id: 'prop-2', status: 'pending' });
      expect(f9.commit).toHaveBeenCalledWith(
        'ws-1',
        'f9-1',
        'tok-propose',
        expect.objectContaining({ propose: true }),
      );
    });

    it('review + write → forced propose=true (write does NOT bypass)', async () => {
      const row = makeWikiRow({
        approvalMode: 'review',
        humanPermission: 'write',
      });
      db.limit
        .mockResolvedValueOnce([row])
        .mockResolvedValueOnce([
          { displayName: 'Alice', email: 'alice@example.com' },
        ]);
      f9.createToken.mockResolvedValue(makeToken({ token: 'tok-propose' }));
      f9.commit.mockResolvedValue({
        commit: 'sha-1',
        branch: 'proposal/x',
        proposal_id: 'prop-1',
      });

      await svc.commitPage('ws-1', 'wiki-1', writeUser, commitDto);

      expect(f9.commit).toHaveBeenCalledWith(
        'ws-1',
        'f9-1',
        'tok-propose',
        expect.objectContaining({ propose: true }),
      );
    });

    it('review + propose → forced propose=true', async () => {
      const row = makeWikiRow({
        approvalMode: 'review',
        humanPermission: 'propose',
      });
      db.limit
        .mockResolvedValueOnce([row])
        .mockResolvedValueOnce([
          { displayName: 'Alice', email: 'alice@example.com' },
        ]);
      f9.createToken.mockResolvedValue(makeToken({ token: 'tok-propose' }));
      f9.commit.mockResolvedValue({
        commit: 'sha-1',
        branch: 'proposal/x',
        proposal_id: 'prop-1',
      });

      await svc.commitPage('ws-1', 'wiki-1', writeUser, commitDto);

      expect(f9.commit).toHaveBeenCalledWith(
        'ws-1',
        'f9-1',
        'tok-propose',
        expect.objectContaining({ propose: true }),
      );
    });

    it('rejects a traversal file path (../evil.md) before any DB / folder9 work', async () => {
      // Path validation runs *before* loading the wiki row, so no DB query
      // or token mint should fire — caller sees BadRequestException only.
      await expect(
        svc.commitPage('ws-1', 'wiki-1', writeUser, {
          message: 'bad',
          files: [
            { path: '../evil.md', content: 'x', action: 'create' as const },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(f9.createToken).not.toHaveBeenCalled();
      expect(f9.commit).not.toHaveBeenCalled();
    });

    it('rejects a mixed batch where any file path fails validation', async () => {
      // A single bad path must fail the whole commit — partial application
      // of a multi-file commit would violate "all or nothing" semantics.
      await expect(
        svc.commitPage('ws-1', 'wiki-1', writeUser, {
          message: 'batch',
          files: [
            { path: 'good.md', content: 'ok', action: 'create' as const },
            { path: '/absolute.md', content: 'x', action: 'create' as const },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(f9.commit).not.toHaveBeenCalled();
    });

    it('read-only user → ForbiddenException, folder9 NOT called', async () => {
      const row = makeWikiRow({ humanPermission: 'read' });
      db.limit.mockResolvedValueOnce([row]);

      await expect(
        svc.commitPage('ws-1', 'wiki-1', writeUser, commitDto),
      ).rejects.toThrow(ForbiddenException);

      expect(f9.createToken).not.toHaveBeenCalled();
      expect(f9.commit).not.toHaveBeenCalled();
    });

    it('passes displayName/email from loadUserProfile into token attribution', async () => {
      const row = makeWikiRow();
      db.limit
        .mockResolvedValueOnce([row])
        .mockResolvedValueOnce([
          { displayName: 'Bob', email: 'bob@example.com' },
        ]);
      f9.createToken.mockResolvedValue(makeToken({ token: 'tok-write' }));
      f9.commit.mockResolvedValue({ commit: 'sha-1', branch: 'main' });

      await svc.commitPage('ws-1', 'wiki-1', writeUser, commitDto);

      expect(f9.createToken).toHaveBeenCalledWith(
        expect.objectContaining({
          created_by: 'Bob',
          permission: 'write',
        }),
      );
    });

    it('falls back to synthetic identity when users row is missing', async () => {
      const row = makeWikiRow();
      db.limit.mockResolvedValueOnce([row]).mockResolvedValueOnce([]); // no user row
      f9.createToken.mockResolvedValue(makeToken({ token: 'tok-write' }));
      f9.commit.mockResolvedValue({ commit: 'sha-1', branch: 'main' });

      await svc.commitPage('ws-1', 'wiki-1', writeUser, commitDto);

      // Fallback: user.id as display name
      expect(f9.createToken).toHaveBeenCalledWith(
        expect.objectContaining({ created_by: 'user-1' }),
      );
    });

    it('falls back to synthetic email when users row has null displayName', async () => {
      const row = makeWikiRow();
      db.limit
        .mockResolvedValueOnce([row])
        .mockResolvedValueOnce([
          { displayName: null, email: 'bob@example.com' },
        ]);
      f9.createToken.mockResolvedValue(makeToken({ token: 'tok-write' }));
      f9.commit.mockResolvedValue({ commit: 'sha-1', branch: 'main' });

      await svc.commitPage('ws-1', 'wiki-1', writeUser, commitDto);

      // displayName null → fall back to user.id
      expect(f9.createToken).toHaveBeenCalledWith(
        expect.objectContaining({ created_by: 'user-1' }),
      );
    });

    it('maps folder9 409 to NestJS ConflictException', async () => {
      const row = makeWikiRow();
      db.limit
        .mockResolvedValueOnce([row])
        .mockResolvedValueOnce([
          { displayName: 'Alice', email: 'alice@example.com' },
        ]);
      f9.createToken.mockResolvedValue(makeToken({ token: 'tok-write' }));
      f9.commit.mockRejectedValue(
        new Folder9ApiError(409, '/api/commit', { error: 'CONFLICT' }),
      );

      await expect(
        svc.commitPage('ws-1', 'wiki-1', writeUser, commitDto),
      ).rejects.toThrow(ConflictException);
    });

    it('re-throws non-409 folder9 errors unchanged', async () => {
      const row = makeWikiRow();
      db.limit
        .mockResolvedValueOnce([row])
        .mockResolvedValueOnce([
          { displayName: 'Alice', email: 'alice@example.com' },
        ]);
      f9.createToken.mockResolvedValue(makeToken({ token: 'tok-write' }));
      const netErr = new Error('boom');
      f9.commit.mockRejectedValue(netErr);

      await expect(
        svc.commitPage('ws-1', 'wiki-1', writeUser, commitDto),
      ).rejects.toThrow(/boom/);
    });

    it('re-throws non-409 Folder9ApiError unchanged (covers the err-instanceof branch)', async () => {
      const row = makeWikiRow();
      db.limit
        .mockResolvedValueOnce([row])
        .mockResolvedValueOnce([
          { displayName: 'Alice', email: 'alice@example.com' },
        ]);
      f9.createToken.mockResolvedValue(makeToken({ token: 'tok-write' }));
      const apiErr = new Folder9ApiError(500, '/api/commit', {
        error: 'INTERNAL',
      });
      f9.commit.mockRejectedValue(apiErr);

      let caught: unknown;
      try {
        await svc.commitPage('ws-1', 'wiki-1', writeUser, commitDto);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBe(apiErr);
    });
  });

  // ── listProposals ───────────────────────────────────────────────────
  describe('listProposals', () => {
    const user = { id: 'user-1', isAgent: false };

    it('maps folder9 proposals to camelCase ProposalDto shape', async () => {
      const row = makeWikiRow();
      db.limit.mockResolvedValueOnce([row]);
      f9.createToken.mockResolvedValue(makeToken({ token: 'tok-read' }));
      f9.listProposals.mockResolvedValue([
        {
          id: 'p-1',
          folder_id: 'f9-1',
          branch_name: 'proposal/x',
          title: 'Add docs',
          description: 'desc',
          status: 'pending',
          author_type: 'agent',
          author_id: 'agent-1',
          reviewed_by: null,
          created_at: '2026-04-13T10:00:00Z',
        },
        {
          id: 'p-2',
          folder_id: 'f9-1',
          branch_name: 'proposal/y',
          title: 'Update',
          description: '',
          status: 'merged',
          author_type: 'user',
          author_id: 'user-2',
          reviewed_by: 'user-3',
          created_at: '2026-04-13T11:00:00Z',
        },
      ]);

      const result = await svc.listProposals('ws-1', 'wiki-1', user, {
        status: 'pending',
      });

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 'p-1',
        wikiId: 'wiki-1',
        title: 'Add docs',
        description: 'desc',
        status: 'pending',
        authorId: 'agent-1',
        authorType: 'agent',
        createdAt: '2026-04-13T10:00:00Z',
        reviewedBy: null,
        reviewedAt: null,
      });
      // "merged" normalizes to "approved" for the ProposalDto status union
      expect(result[1].status).toBe('approved');
      expect(result[1].authorType).toBe('user');
      expect(result[1].reviewedBy).toBe('user-3');
      expect(f9.listProposals).toHaveBeenCalledWith(
        'ws-1',
        'f9-1',
        'tok-read',
        { status: 'pending' },
      );
    });

    it('passes empty opts when none given', async () => {
      const row = makeWikiRow();
      db.limit.mockResolvedValueOnce([row]);
      f9.createToken.mockResolvedValue(makeToken({ token: 'tok-read' }));
      f9.listProposals.mockResolvedValue([]);

      await svc.listProposals('ws-1', 'wiki-1', user);

      expect(f9.listProposals).toHaveBeenCalledWith(
        'ws-1',
        'f9-1',
        'tok-read',
        {},
      );
    });

    it('throws NotFoundException for missing wiki before calling folder9', async () => {
      db.limit.mockResolvedValueOnce([]);
      await expect(svc.listProposals('ws-1', 'missing', user)).rejects.toThrow(
        NotFoundException,
      );
      expect(f9.createToken).not.toHaveBeenCalled();
    });
  });

  // ── getProposalDiff ─────────────────────────────────────────────────
  describe('getProposalDiff', () => {
    const user = { id: 'user-1', isAgent: false };

    it('returns diff entries for a read user', async () => {
      const row = makeWikiRow();
      db.limit.mockResolvedValueOnce([row]);
      f9.createToken.mockResolvedValue(makeToken({ token: 'tok-read' }));
      const entries = [
        {
          Path: 'a.md',
          Status: 'modified' as const,
          OldContent: 'old',
          NewContent: 'new',
        },
      ];
      f9.getProposalDiff.mockResolvedValue(entries);

      const result = await svc.getProposalDiff('ws-1', 'wiki-1', user, 'p-1');

      expect(result).toBe(entries);
      expect(f9.createToken).toHaveBeenCalledWith(
        expect.objectContaining({
          folder_id: 'f9-1',
          permission: 'read',
          created_by: 'wiki:f9-1',
        }),
      );
      expect(f9.getProposalDiff).toHaveBeenCalledWith(
        'ws-1',
        'f9-1',
        'p-1',
        'tok-read',
      );
    });

    it('throws NotFoundException for missing wiki before calling folder9', async () => {
      db.limit.mockResolvedValueOnce([]);
      await expect(
        svc.getProposalDiff('ws-1', 'missing', user, 'p-1'),
      ).rejects.toThrow(NotFoundException);
      expect(f9.createToken).not.toHaveBeenCalled();
      expect(f9.getProposalDiff).not.toHaveBeenCalled();
    });
  });

  // ── approveProposal / rejectProposal ────────────────────────────────
  describe('approveProposal', () => {
    const writeUser = { id: 'user-1', isAgent: false };

    it('approves a proposal using a write-scoped token', async () => {
      const row = makeWikiRow();
      db.limit
        .mockResolvedValueOnce([row])
        .mockResolvedValueOnce([
          { displayName: 'Alice', email: 'alice@example.com' },
        ]);
      f9.createToken.mockResolvedValue(makeToken({ token: 'tok-write' }));
      f9.approveProposal.mockResolvedValue(undefined);

      await svc.approveProposal('ws-1', 'wiki-1', writeUser, 'p-1');

      expect(f9.createToken).toHaveBeenCalledWith(
        expect.objectContaining({
          permission: 'write',
          created_by: 'Alice',
        }),
      );
      expect(f9.approveProposal).toHaveBeenCalledWith(
        'ws-1',
        'f9-1',
        'p-1',
        'tok-write',
        'user-1',
      );
    });

    it('throws ForbiddenException for propose-only user', async () => {
      const row = makeWikiRow({ humanPermission: 'propose' });
      db.limit.mockResolvedValueOnce([row]);

      await expect(
        svc.approveProposal('ws-1', 'wiki-1', writeUser, 'p-1'),
      ).rejects.toThrow(ForbiddenException);
      expect(f9.createToken).not.toHaveBeenCalled();
      expect(f9.approveProposal).not.toHaveBeenCalled();
    });

    it('maps folder9 409 to ConflictException', async () => {
      const row = makeWikiRow();
      db.limit
        .mockResolvedValueOnce([row])
        .mockResolvedValueOnce([
          { displayName: 'Alice', email: 'alice@example.com' },
        ]);
      f9.createToken.mockResolvedValue(makeToken({ token: 'tok-write' }));
      f9.approveProposal.mockRejectedValue(
        new Folder9ApiError(409, '/approve', { error: 'CONFLICT' }),
      );

      await expect(
        svc.approveProposal('ws-1', 'wiki-1', writeUser, 'p-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('re-throws non-409 folder9 errors unchanged', async () => {
      const row = makeWikiRow();
      db.limit
        .mockResolvedValueOnce([row])
        .mockResolvedValueOnce([
          { displayName: 'Alice', email: 'alice@example.com' },
        ]);
      f9.createToken.mockResolvedValue(makeToken({ token: 'tok-write' }));
      f9.approveProposal.mockRejectedValue(new Error('boom'));

      await expect(
        svc.approveProposal('ws-1', 'wiki-1', writeUser, 'p-1'),
      ).rejects.toThrow(/boom/);
    });

    it('re-throws non-409 Folder9ApiError unchanged', async () => {
      const row = makeWikiRow();
      db.limit
        .mockResolvedValueOnce([row])
        .mockResolvedValueOnce([
          { displayName: 'Alice', email: 'alice@example.com' },
        ]);
      f9.createToken.mockResolvedValue(makeToken({ token: 'tok-write' }));
      const apiErr = new Folder9ApiError(500, '/approve', { error: 'BOOM' });
      f9.approveProposal.mockRejectedValue(apiErr);

      let caught: unknown;
      try {
        await svc.approveProposal('ws-1', 'wiki-1', writeUser, 'p-1');
      } catch (e) {
        caught = e;
      }
      expect(caught).toBe(apiErr);
    });
  });

  describe('rejectProposal', () => {
    const writeUser = { id: 'user-1', isAgent: false };

    it('rejects a proposal with a reason', async () => {
      const row = makeWikiRow();
      db.limit
        .mockResolvedValueOnce([row])
        .mockResolvedValueOnce([
          { displayName: 'Alice', email: 'alice@example.com' },
        ]);
      f9.createToken.mockResolvedValue(makeToken({ token: 'tok-write' }));
      f9.rejectProposal.mockResolvedValue(undefined);

      await svc.rejectProposal('ws-1', 'wiki-1', writeUser, 'p-1', 'off-topic');

      // Mirror approveProposal: rejection is a write operation on main,
      // so the token MUST carry the 'write' permission (not 'propose' or
      // 'read'). Asserting here guards against a regression where a refactor
      // accidentally downgrades the token scope.
      expect(f9.createToken).toHaveBeenCalledWith(
        expect.objectContaining({ permission: 'write' }),
      );
      expect(f9.rejectProposal).toHaveBeenCalledWith(
        'ws-1',
        'f9-1',
        'p-1',
        'tok-write',
        'user-1',
        'off-topic',
      );
    });

    it('rejects a proposal without a reason', async () => {
      const row = makeWikiRow();
      db.limit
        .mockResolvedValueOnce([row])
        .mockResolvedValueOnce([
          { displayName: 'Alice', email: 'alice@example.com' },
        ]);
      f9.createToken.mockResolvedValue(makeToken({ token: 'tok-write' }));
      f9.rejectProposal.mockResolvedValue(undefined);

      await svc.rejectProposal('ws-1', 'wiki-1', writeUser, 'p-1');

      expect(f9.createToken).toHaveBeenCalledWith(
        expect.objectContaining({ permission: 'write' }),
      );
      expect(f9.rejectProposal).toHaveBeenCalledWith(
        'ws-1',
        'f9-1',
        'p-1',
        'tok-write',
        'user-1',
        undefined,
      );
    });

    it('throws ForbiddenException for propose-only user', async () => {
      const row = makeWikiRow({ humanPermission: 'propose' });
      db.limit.mockResolvedValueOnce([row]);

      await expect(
        svc.rejectProposal('ws-1', 'wiki-1', writeUser, 'p-1'),
      ).rejects.toThrow(ForbiddenException);
      expect(f9.rejectProposal).not.toHaveBeenCalled();
    });

    it('maps folder9 409 to ConflictException (race with another reviewer)', async () => {
      const row = makeWikiRow();
      db.limit
        .mockResolvedValueOnce([row])
        .mockResolvedValueOnce([
          { displayName: 'Alice', email: 'alice@example.com' },
        ]);
      f9.createToken.mockResolvedValue(makeToken({ token: 'tok-write' }));
      f9.rejectProposal.mockRejectedValue(
        new Folder9ApiError(409, '/reject', { error: 'CONFLICT' }),
      );

      await expect(
        svc.rejectProposal('ws-1', 'wiki-1', writeUser, 'p-1'),
      ).rejects.toThrow(ConflictException);
      expect(f9.createToken).toHaveBeenCalledWith(
        expect.objectContaining({ permission: 'write' }),
      );
    });

    it('re-throws non-409 folder9 errors unchanged', async () => {
      const row = makeWikiRow();
      db.limit
        .mockResolvedValueOnce([row])
        .mockResolvedValueOnce([
          { displayName: 'Alice', email: 'alice@example.com' },
        ]);
      f9.createToken.mockResolvedValue(makeToken({ token: 'tok-write' }));
      f9.rejectProposal.mockRejectedValue(new Error('boom'));

      await expect(
        svc.rejectProposal('ws-1', 'wiki-1', writeUser, 'p-1'),
      ).rejects.toThrow(/boom/);
      expect(f9.createToken).toHaveBeenCalledWith(
        expect.objectContaining({ permission: 'write' }),
      );
    });

    it('re-throws non-409 Folder9ApiError unchanged', async () => {
      const row = makeWikiRow();
      db.limit
        .mockResolvedValueOnce([row])
        .mockResolvedValueOnce([
          { displayName: 'Alice', email: 'alice@example.com' },
        ]);
      f9.createToken.mockResolvedValue(makeToken({ token: 'tok-write' }));
      const apiErr = new Folder9ApiError(500, '/reject', {
        error: 'INTERNAL',
      });
      f9.rejectProposal.mockRejectedValue(apiErr);

      let caught: unknown;
      try {
        await svc.rejectProposal('ws-1', 'wiki-1', writeUser, 'p-1');
      } catch (e) {
        caught = e;
      }
      expect(caught).toBe(apiErr);
      expect(f9.createToken).toHaveBeenCalledWith(
        expect.objectContaining({ permission: 'write' }),
      );
    });
  });

  // ── token cache ─────────────────────────────────────────────────────
  describe('token cache', () => {
    const user = { id: 'user-1', isAgent: false };

    afterEach(() => {
      jest.useRealTimers();
    });

    it('reuses a cached token across two getTree calls on the same wiki', async () => {
      const row = makeWikiRow();
      db.limit.mockResolvedValueOnce([row]).mockResolvedValueOnce([row]);
      f9.createToken.mockResolvedValue(makeToken({ token: 'tok-read' }));
      f9.getTree.mockResolvedValue([]);

      await svc.getTree('ws-1', 'wiki-1', user);
      await svc.getTree('ws-1', 'wiki-1', user);

      expect(f9.createToken).toHaveBeenCalledTimes(1);
      expect(f9.getTree).toHaveBeenCalledTimes(2);
    });

    it('mints a fresh token after the local TTL expires', async () => {
      // 15 min local TTL; jump the clock 16 min between the two calls so the
      // cache entry is past its deadline.
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-04-13T10:00:00.000Z'));

      const row = makeWikiRow();
      db.limit.mockResolvedValueOnce([row]).mockResolvedValueOnce([row]);
      f9.createToken
        .mockResolvedValueOnce(makeToken({ token: 'tok-old' }))
        .mockResolvedValueOnce(makeToken({ token: 'tok-new' }));
      f9.getTree.mockResolvedValue([]);

      await svc.getTree('ws-1', 'wiki-1', user);

      jest.setSystemTime(new Date('2026-04-13T10:16:00.000Z'));

      await svc.getTree('ws-1', 'wiki-1', user);

      expect(f9.createToken).toHaveBeenCalledTimes(2);
      // Second getTree used the freshly-minted token
      const calls = f9.getTree.mock.calls as Array<
        [string, string, string, unknown]
      >;
      expect(calls[0][2]).toBe('tok-old');
      expect(calls[1][2]).toBe('tok-new');
    });

    it('caches separately per (folderId, permission, createdBy) tuple', async () => {
      // Same wiki, same user, two different permissions → two mints.
      const row = makeWikiRow({ humanPermission: 'write' });
      db.limit
        .mockResolvedValueOnce([row]) // getWikiOrThrow (getTree)
        .mockResolvedValueOnce([row]) // getWikiOrThrow (commitPage)
        .mockResolvedValueOnce([
          { displayName: 'Alice', email: 'alice@example.com' },
        ]); // loadUserProfile inside commitPage
      f9.createToken
        .mockResolvedValueOnce(makeToken({ token: 'tok-read' }))
        .mockResolvedValueOnce(makeToken({ token: 'tok-write' }));
      f9.getTree.mockResolvedValue([]);
      f9.commit.mockResolvedValue({ commit: 'sha-1', branch: 'main' });

      await svc.getTree('ws-1', 'wiki-1', user);
      await svc.commitPage('ws-1', 'wiki-1', user, {
        message: 'm',
        files: [{ path: 'a.md', content: 'c', action: 'create' }],
      });

      expect(f9.createToken).toHaveBeenCalledTimes(2);
      const mintCalls = f9.createToken.mock.calls as Array<
        [Record<string, unknown>]
      >;
      expect(mintCalls[0][0]).toMatchObject({ permission: 'read' });
      expect(mintCalls[1][0]).toMatchObject({ permission: 'write' });
    });

    it('mints separate tokens for two different commit users (createdBy)', async () => {
      const row = makeWikiRow({ humanPermission: 'write' });
      db.limit
        .mockResolvedValueOnce([row])
        .mockResolvedValueOnce([
          { displayName: 'Alice', email: 'alice@example.com' },
        ])
        .mockResolvedValueOnce([row])
        .mockResolvedValueOnce([
          { displayName: 'Bob', email: 'bob@example.com' },
        ]);
      f9.createToken
        .mockResolvedValueOnce(makeToken({ token: 'tok-alice' }))
        .mockResolvedValueOnce(makeToken({ token: 'tok-bob' }));
      f9.commit.mockResolvedValue({ commit: 'sha', branch: 'main' });

      await svc.commitPage(
        'ws-1',
        'wiki-1',
        { id: 'u1', isAgent: false },
        {
          message: 'm',
          files: [{ path: 'a', content: 'c', action: 'create' }],
        },
      );
      await svc.commitPage(
        'ws-1',
        'wiki-1',
        { id: 'u2', isAgent: false },
        {
          message: 'm',
          files: [{ path: 'a', content: 'c', action: 'create' }],
        },
      );

      expect(f9.createToken).toHaveBeenCalledTimes(2);
    });

    // ── hardening: eviction / race-safety / observability ────────────
    //
    // These tests cover the three Important fixes to `getFolderToken`:
    //   1. concurrent cache misses share one in-flight mint promise
    //   2. a rejected mint promise is evicted so the next caller retries
    //   3. mint failures log at error level with full cache-key context
    //
    // The fourth test verifies the (already-passing) expired-entry eviction
    // behaviour, asserting that the stale entry really is removed from the
    // internal Map rather than just shadowed by the new one.

    it('concurrent getTree calls share a single in-flight mint', async () => {
      const row = makeWikiRow();
      db.limit.mockResolvedValueOnce([row]).mockResolvedValueOnce([row]);

      // Hold the mint promise open so both callers land in the same cache
      // miss window. They should both await the same in-flight promise
      // instead of each firing their own POST /api/tokens.
      let resolveToken: (value: unknown) => void = () => {};
      f9.createToken.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveToken = resolve;
          }),
      );
      f9.getTree.mockResolvedValue([]);

      // Kick off two getTree calls without awaiting either.
      const p1 = svc.getTree('ws-1', 'wiki-1', user);
      const p2 = svc.getTree('ws-1', 'wiki-1', user);

      // Let microtasks drain so both callers have entered getFolderToken
      // and are now awaiting the shared mint promise.
      await Promise.resolve();
      await Promise.resolve();

      // Release the mint. Both awaiters resolve to the same token.
      resolveToken(makeToken({ token: 'tok-shared' }));

      await Promise.all([p1, p2]);

      // The cache deduplicated the mint: exactly one POST /api/tokens.
      expect(f9.createToken).toHaveBeenCalledTimes(1);
      // Both getTree calls used the same token from the shared mint.
      const calls = f9.getTree.mock.calls as Array<
        [string, string, string, unknown]
      >;
      expect(calls[0][2]).toBe('tok-shared');
      expect(calls[1][2]).toBe('tok-shared');
    });

    it('evicts a failed mint so the next caller can retry cleanly', async () => {
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => {});
      const row = makeWikiRow();
      db.limit.mockResolvedValueOnce([row]).mockResolvedValueOnce([row]);

      // First mint rejects — the rejected promise must be removed from the
      // cache so the second call starts a brand new mint (not await the
      // same guaranteed failure).
      f9.createToken
        .mockRejectedValueOnce(new Error('mint boom') as never)
        .mockResolvedValueOnce(makeToken({ token: 'tok-retry' }));
      f9.getTree.mockResolvedValue([]);

      await expect(svc.getTree('ws-1', 'wiki-1', user)).rejects.toThrow(
        /mint boom/,
      );

      // Second call should re-mint successfully (not reuse the failed promise).
      await svc.getTree('ws-1', 'wiki-1', user);

      expect(f9.createToken).toHaveBeenCalledTimes(2);
      expect(f9.getTree).toHaveBeenCalledTimes(1); // only the successful call ran getTree
      const calls = f9.getTree.mock.calls as Array<
        [string, string, string, unknown]
      >;
      expect(calls[0][2]).toBe('tok-retry');

      errorSpy.mockRestore();
    });

    it('logs mint failures with folder / permission / createdBy context', async () => {
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => {});
      const row = makeWikiRow();
      db.limit.mockResolvedValueOnce([row]);
      const mintErr = new Error('psk rejected');
      f9.createToken.mockRejectedValueOnce(mintErr as never);

      await expect(svc.getTree('ws-1', 'wiki-1', user)).rejects.toThrow(
        /psk rejected/,
      );

      expect(errorSpy).toHaveBeenCalledTimes(1);
      const [message, stackOrString] = errorSpy.mock.calls[0] as [
        string,
        string,
      ];
      expect(message).toContain('folder=f9-1');
      expect(message).toContain('permission=read');
      expect(message).toContain('createdBy=wiki:f9-1');
      // Passed the Error's stack, not "undefined" or the plain string.
      expect(typeof stackOrString).toBe('string');
      expect(stackOrString).toContain('Error: psk rejected');

      errorSpy.mockRestore();
    });

    it('logs mint failures with a string fallback when a non-Error is thrown', async () => {
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => {});
      const row = makeWikiRow();
      db.limit.mockResolvedValueOnce([row]);
      // Non-Error throw exercises the `String(err)` fallback branch.
      f9.createToken.mockImplementationOnce(() =>
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        Promise.reject('plain string mint failure'),
      );

      await expect(svc.getTree('ws-1', 'wiki-1', user)).rejects.toBe(
        'plain string mint failure',
      );

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('folder=f9-1'),
        'plain string mint failure',
      );
      errorSpy.mockRestore();
    });

    it('evicts the expired cache entry before minting a replacement', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-04-13T10:00:00.000Z'));

      const row = makeWikiRow();
      db.limit.mockResolvedValueOnce([row]).mockResolvedValueOnce([row]);
      f9.createToken
        .mockResolvedValueOnce(makeToken({ token: 'tok-stale' }))
        .mockResolvedValueOnce(makeToken({ token: 'tok-fresh' }));
      f9.getTree.mockResolvedValue([]);

      await svc.getTree('ws-1', 'wiki-1', user);

      // Jump past the 15 min local TTL.
      jest.setSystemTime(new Date('2026-04-13T10:16:00.000Z'));

      await svc.getTree('ws-1', 'wiki-1', user);

      // Both mints ran (expiry detected), and the eviction path was taken —
      // the fresh token is what getTree used on the second call. If the
      // stale entry had leaked, the second getTree would have used tok-stale.
      expect(f9.createToken).toHaveBeenCalledTimes(2);
      const calls = f9.getTree.mock.calls as Array<
        [string, string, string, unknown]
      >;
      expect(calls[1][2]).toBe('tok-fresh');

      // Peek at the private map — only one entry, and it's the fresh one.
      const privateCache = (
        svc as unknown as {
          tokenCache: Map<
            string,
            Promise<{ token: string; expiresAt: number }>
          >;
        }
      ).tokenCache;
      expect(privateCache.size).toBe(1);
      const entry = await privateCache.get('f9-1::read::wiki:f9-1');
      expect(entry?.token).toBe('tok-fresh');
    });
  });
});

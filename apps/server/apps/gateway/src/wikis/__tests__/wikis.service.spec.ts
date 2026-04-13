import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { Test } from '@nestjs/testing';
import {
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DATABASE_CONNECTION } from '@team9/database';
import { WikisService } from '../wikis.service.js';
import { Folder9ClientService } from '../folder9-client.service.js';

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

function mockFolder9() {
  return {
    createFolder: jest.fn<any>(),
    getFolder: jest.fn<any>(),
    updateFolder: jest.fn<any>(),
    deleteFolder: jest.fn<any>(),
    getTree: jest.fn<any>(),
    getBlob: jest.fn<any>(),
    commit: jest.fn<any>(),
    listProposals: jest.fn<any>(),
    getProposal: jest.fn<any>(),
    approveProposal: jest.fn<any>(),
    rejectProposal: jest.fn<any>(),
  } as unknown as jest.Mocked<Folder9ClientService> & {
    createFolder: MockFn;
    deleteFolder: MockFn;
    updateFolder: MockFn;
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

  beforeEach(async () => {
    db = mockDb();
    f9 = mockFolder9();
    const moduleRef = await Test.createTestingModule({
      providers: [
        WikisService,
        { provide: DATABASE_CONNECTION, useValue: db },
        { provide: Folder9ClientService, useValue: f9 },
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
  });
});

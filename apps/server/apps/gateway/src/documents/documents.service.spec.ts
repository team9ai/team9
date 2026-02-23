import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { Test, type TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DATABASE_CONNECTION } from '@team9/database';
import type {
  Document,
  DocumentIdentity,
  DocumentPrivilege,
} from '@team9/database/schemas';
import { DocumentsService } from './documents.service.js';

// ── Mock DB helper ──────────────────────────────────────────────────

type MockFn = jest.Mock<(...args: any[]) => any>;

function mockDb() {
  const chain: Record<string, MockFn> = {};
  const methods = [
    'select',
    'from',
    'where',
    'limit',
    'insert',
    'values',
    'returning',
    'update',
    'set',
    'innerJoin',
    'leftJoin',
    'orderBy',
    'offset',
    'groupBy',
    'having',
  ];
  for (const m of methods) {
    chain[m] = jest.fn<any>().mockReturnValue(chain);
  }
  chain.limit.mockResolvedValue([]);
  chain.returning.mockResolvedValue([]);
  return chain;
}

// ── Test fixtures ───────────────────────────────────────────────────

const USER_ALICE: DocumentIdentity = { type: 'user', id: 'user-alice' };
const USER_BOB: DocumentIdentity = { type: 'user', id: 'user-bob' };
const BOT_CLAW: DocumentIdentity = { type: 'bot', id: 'bot-claw' };
const BOT_OTHER: DocumentIdentity = { type: 'bot', id: 'bot-other' };
const WS_ALL: DocumentIdentity = { type: 'workspace', userType: 'all' };
const WS_USERS: DocumentIdentity = { type: 'workspace', userType: 'user' };
const WS_BOTS: DocumentIdentity = { type: 'workspace', userType: 'bot' };

function makeDoc(privileges: DocumentPrivilege[]): Document {
  return {
    id: 'doc-1',
    tenantId: 'tenant-1',
    documentType: 'task_instruction',
    title: 'Test Doc',
    privileges,
    currentVersionId: 'ver-1',
    createdBy: USER_ALICE,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('DocumentsService', () => {
  let service: DocumentsService;
  let db: ReturnType<typeof mockDb>;

  beforeEach(async () => {
    db = mockDb();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentsService,
        { provide: DATABASE_CONNECTION, useValue: db },
      ],
    }).compile();
    service = module.get<DocumentsService>(DocumentsService);
  });

  // ────────────────────────────────────────────────────────────────
  // create() — default privilege assignment
  // ────────────────────────────────────────────────────────────────

  describe('create() — default privilege assignment', () => {
    const now = new Date();
    const WS_USERS_OWNER: DocumentPrivilege = {
      identity: WS_USERS,
      role: 'owner',
    };

    function mockCreateReturns(
      db: ReturnType<typeof mockDb>,
      docRow: any,
      versionRow: any,
    ) {
      let returningCount = 0;
      db.returning.mockImplementation((() => {
        returningCount++;
        if (returningCount === 1) return Promise.resolve([docRow]);
        if (returningCount === 2) return Promise.resolve([versionRow]);
        return Promise.resolve([]);
      }) as any);
    }

    it('should set creator as owner + workspace users as owner when no privileges provided', async () => {
      const expectedPrivileges = [
        { identity: USER_ALICE, role: 'owner' },
        WS_USERS_OWNER,
      ];
      const docRow = {
        id: 'doc-1',
        tenantId: 'tenant-1',
        documentType: 'task_instruction',
        title: null,
        privileges: expectedPrivileges,
        currentVersionId: 'ver-1',
        createdBy: USER_ALICE,
        createdAt: now,
        updatedAt: now,
      };
      const versionRow = {
        id: 'ver-1',
        documentId: 'doc-1',
        versionIndex: 1,
        content: 'hello',
        summary: 'Initial version',
        updatedBy: USER_ALICE,
        createdAt: now,
      };
      mockCreateReturns(db, docRow, versionRow);

      const result = await service.create(
        { documentType: 'task_instruction', content: 'hello' },
        USER_ALICE,
        'tenant-1',
      );

      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({
          privileges: expectedPrivileges,
        }),
      );
      expect(result.currentVersion?.versionIndex).toBe(1);
    });

    it('should auto-add creator + workspace users owner when custom privileges miss both', async () => {
      const customPrivileges: DocumentPrivilege[] = [
        { identity: WS_BOTS, role: 'suggester' },
      ];

      const docRow = {
        id: 'doc-1',
        tenantId: 'tenant-1',
        documentType: 'task_instruction',
        title: null,
        privileges: [],
        currentVersionId: 'ver-1',
        createdBy: USER_ALICE,
        createdAt: now,
        updatedAt: now,
      };
      const versionRow = {
        id: 'ver-1',
        documentId: 'doc-1',
        versionIndex: 1,
        content: 'hello',
        summary: 'Initial version',
        updatedBy: USER_ALICE,
        createdAt: now,
      };
      mockCreateReturns(db, docRow, versionRow);

      await service.create(
        {
          documentType: 'task_instruction',
          content: 'hello',
          privileges: customPrivileges,
        },
        USER_ALICE,
        'tenant-1',
      );

      // Creator + WS_USERS_OWNER should both be appended
      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({
          privileges: expect.arrayContaining([
            { identity: USER_ALICE, role: 'owner' },
            { identity: WS_BOTS, role: 'suggester' },
            WS_USERS_OWNER,
          ]),
        }),
      );
    });

    it('should NOT duplicate creator when custom privileges already include them', async () => {
      const customPrivileges: DocumentPrivilege[] = [
        { identity: USER_ALICE, role: 'editor' },
        { identity: WS_BOTS, role: 'suggester' },
      ];
      const docRow = {
        id: 'doc-1',
        tenantId: 'tenant-1',
        documentType: 'task_instruction',
        title: null,
        privileges: customPrivileges,
        currentVersionId: 'ver-1',
        createdBy: USER_ALICE,
        createdAt: now,
        updatedAt: now,
      };
      const versionRow = {
        id: 'ver-1',
        documentId: 'doc-1',
        versionIndex: 1,
        content: 'hello',
        summary: 'Initial version',
        updatedBy: USER_ALICE,
        createdAt: now,
      };
      mockCreateReturns(db, docRow, versionRow);

      await service.create(
        {
          documentType: 'task_instruction',
          content: 'hello',
          privileges: customPrivileges,
        },
        USER_ALICE,
        'tenant-1',
      );

      // Creator not duplicated, but WS_USERS_OWNER appended
      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({
          privileges: expect.arrayContaining([
            ...customPrivileges,
            WS_USERS_OWNER,
          ]),
        }),
      );
    });

    it('should NOT duplicate workspace users owner when already present', async () => {
      const customPrivileges: DocumentPrivilege[] = [
        { identity: USER_ALICE, role: 'owner' },
        WS_USERS_OWNER,
      ];
      const docRow = {
        id: 'doc-1',
        tenantId: 'tenant-1',
        documentType: 'task_instruction',
        title: null,
        privileges: customPrivileges,
        currentVersionId: 'ver-1',
        createdBy: USER_ALICE,
        createdAt: now,
        updatedAt: now,
      };
      const versionRow = {
        id: 'ver-1',
        documentId: 'doc-1',
        versionIndex: 1,
        content: 'hello',
        summary: 'Initial version',
        updatedBy: USER_ALICE,
        createdAt: now,
      };
      mockCreateReturns(db, docRow, versionRow);

      await service.create(
        {
          documentType: 'task_instruction',
          content: 'hello',
          privileges: customPrivileges,
        },
        USER_ALICE,
        'tenant-1',
      );

      // Both already present, no duplicates
      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({
          privileges: customPrivileges,
        }),
      );
    });

    it('should NOT duplicate workspace users owner when workspace(all) owner exists', async () => {
      const customPrivileges: DocumentPrivilege[] = [
        { identity: USER_ALICE, role: 'owner' },
        { identity: WS_ALL, role: 'owner' },
      ];
      const docRow = {
        id: 'doc-1',
        tenantId: 'tenant-1',
        documentType: 'task_instruction',
        title: null,
        privileges: customPrivileges,
        currentVersionId: 'ver-1',
        createdBy: USER_ALICE,
        createdAt: now,
        updatedAt: now,
      };
      const versionRow = {
        id: 'ver-1',
        documentId: 'doc-1',
        versionIndex: 1,
        content: 'hello',
        summary: 'Initial version',
        updatedBy: USER_ALICE,
        createdAt: now,
      };
      mockCreateReturns(db, docRow, versionRow);

      await service.create(
        {
          documentType: 'task_instruction',
          content: 'hello',
          privileges: customPrivileges,
        },
        USER_ALICE,
        'tenant-1',
      );

      // workspace(all) owner covers users, no WS_USERS_OWNER needed
      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({
          privileges: customPrivileges,
        }),
      );
    });

    it('bot creator should get owner + workspace users owner by default', async () => {
      const expectedPrivileges = [
        { identity: BOT_CLAW, role: 'owner' },
        WS_USERS_OWNER,
      ];
      const docRow = {
        id: 'doc-1',
        tenantId: 'tenant-1',
        documentType: 'bot_notes',
        title: null,
        privileges: expectedPrivileges,
        currentVersionId: 'ver-1',
        createdBy: BOT_CLAW,
        createdAt: now,
        updatedAt: now,
      };
      const versionRow = {
        id: 'ver-1',
        documentId: 'doc-1',
        versionIndex: 1,
        content: 'bot doc',
        summary: 'Initial version',
        updatedBy: BOT_CLAW,
        createdAt: now,
      };
      mockCreateReturns(db, docRow, versionRow);

      await service.create(
        { documentType: 'bot_notes', content: 'bot doc' },
        BOT_CLAW,
        'tenant-1',
      );

      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({
          privileges: expectedPrivileges,
          createdBy: BOT_CLAW,
        }),
      );
    });

    it('bot creator recognized via workspace(bot) privilege should not be duplicated', async () => {
      const customPrivileges: DocumentPrivilege[] = [
        { identity: USER_ALICE, role: 'owner' },
        { identity: WS_BOTS, role: 'editor' },
      ];
      const docRow = {
        id: 'doc-1',
        tenantId: 'tenant-1',
        documentType: 'task_instruction',
        title: null,
        privileges: customPrivileges,
        currentVersionId: 'ver-1',
        createdBy: BOT_CLAW,
        createdAt: now,
        updatedAt: now,
      };
      const versionRow = {
        id: 'ver-1',
        documentId: 'doc-1',
        versionIndex: 1,
        content: 'hello',
        summary: 'Initial version',
        updatedBy: BOT_CLAW,
        createdAt: now,
      };
      mockCreateReturns(db, docRow, versionRow);

      await service.create(
        {
          documentType: 'task_instruction',
          content: 'hello',
          privileges: customPrivileges,
        },
        BOT_CLAW,
        'tenant-1',
      );

      // Bot matches WS_BOTS (not duplicated), but WS_USERS_OWNER appended
      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({
          privileges: expect.arrayContaining([
            ...customPrivileges,
            WS_USERS_OWNER,
          ]),
        }),
      );
    });
  });

  // ────────────────────────────────────────────────────────────────
  // getSuggestionWithDiff() — diff generation
  // ────────────────────────────────────────────────────────────────

  describe('getSuggestionWithDiff()', () => {
    const baseSuggestionRow = {
      id: 'sug-1',
      documentId: 'doc-1',
      fromVersionId: 'ver-1',
      suggestedBy: BOT_CLAW,
      data: {
        type: 'replace' as const,
        content: 'line1\nline2 changed\nline3\n',
      },
      summary: 'Fix typo',
      status: 'pending' as const,
      reviewedBy: null,
      reviewedAt: null,
      resultVersionId: null,
      createdAt: new Date(),
    };

    it('should generate diff between current version and suggestion', async () => {
      const fromVersion = {
        id: 'ver-1',
        documentId: 'doc-1',
        versionIndex: 1,
        content: 'line1\nline2\nline3\n',
        summary: 'Initial',
        updatedBy: USER_ALICE,
        createdAt: new Date(),
      };

      let limitCallCount = 0;
      db.limit.mockImplementation((() => {
        limitCallCount++;
        if (limitCallCount === 1) return Promise.resolve([baseSuggestionRow]); // suggestion
        if (limitCallCount === 2) return Promise.resolve([fromVersion]); // fromVersion
        if (limitCallCount === 3)
          return Promise.resolve([{ currentVersionId: 'ver-1' }]); // doc
        if (limitCallCount === 4) return Promise.resolve([fromVersion]); // currentVersion (same)
        return Promise.resolve([]);
      }) as any);

      const result = await service.getSuggestionWithDiff('sug-1');

      expect(result.isOutdated).toBe(false);
      expect(result.diff).toBeDefined();
      expect(result.diff.length).toBeGreaterThan(0);
      // Diff should contain changes
      const hasAdditions = result.diff.some((c) => c.added);
      const hasRemovals = result.diff.some((c) => c.removed);
      expect(hasAdditions || hasRemovals).toBe(true);
    });

    it('should mark as outdated when fromVersionId !== currentVersionId', async () => {
      const fromVersion = {
        id: 'ver-1',
        documentId: 'doc-1',
        versionIndex: 1,
        content: 'original\n',
        summary: 'Initial',
        updatedBy: USER_ALICE,
        createdAt: new Date(),
      };
      const currentVersion = {
        id: 'ver-2',
        documentId: 'doc-1',
        versionIndex: 2,
        content: 'original edited\n',
        summary: 'Edit',
        updatedBy: USER_ALICE,
        createdAt: new Date(),
      };

      let limitCallCount = 0;
      db.limit.mockImplementation((() => {
        limitCallCount++;
        if (limitCallCount === 1) return Promise.resolve([baseSuggestionRow]);
        if (limitCallCount === 2) return Promise.resolve([fromVersion]);
        if (limitCallCount === 3)
          return Promise.resolve([{ currentVersionId: 'ver-2' }]); // doc points to ver-2
        if (limitCallCount === 4) return Promise.resolve([currentVersion]);
        return Promise.resolve([]);
      }) as any);

      const result = await service.getSuggestionWithDiff('sug-1');

      expect(result.isOutdated).toBe(true);
      // Diff should compare against current version (ver-2), not fromVersion
      expect(result.currentVersion?.versionIndex).toBe(2);
    });

    it('should return empty diff when suggestion content matches current', async () => {
      const sameContentSuggestion = {
        ...baseSuggestionRow,
        data: { type: 'replace' as const, content: 'same content\n' },
      };
      const version = {
        id: 'ver-1',
        documentId: 'doc-1',
        versionIndex: 1,
        content: 'same content\n',
        summary: 'Initial',
        updatedBy: USER_ALICE,
        createdAt: new Date(),
      };

      let limitCallCount = 0;
      db.limit.mockImplementation((() => {
        limitCallCount++;
        if (limitCallCount === 1)
          return Promise.resolve([sameContentSuggestion]);
        if (limitCallCount === 2) return Promise.resolve([version]);
        if (limitCallCount === 3)
          return Promise.resolve([{ currentVersionId: 'ver-1' }]);
        if (limitCallCount === 4) return Promise.resolve([version]);
        return Promise.resolve([]);
      }) as any);

      const result = await service.getSuggestionWithDiff('sug-1');

      // No additions or removals when content is the same
      const hasChanges = result.diff.some((c) => c.added || c.removed);
      expect(hasChanges).toBe(false);
    });

    it('should throw NotFoundException for missing suggestion', async () => {
      db.limit.mockResolvedValueOnce([]);

      await expect(
        service.getSuggestionWithDiff('nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // matchIdentity (tested via the public checkPermission method)
  // ────────────────────────────────────────────────────────────────

  describe('matchIdentity', () => {
    it('should match user identity with same id', () => {
      const doc = makeDoc([{ identity: USER_ALICE, role: 'owner' }]);
      expect(service.checkPermission(doc, USER_ALICE, ['owner'])).toBe(true);
    });

    it('should NOT match user identity with different id', () => {
      const doc = makeDoc([{ identity: USER_ALICE, role: 'owner' }]);
      expect(service.checkPermission(doc, USER_BOB, ['owner'])).toBe(false);
    });

    it('should match bot identity with same id', () => {
      const doc = makeDoc([{ identity: BOT_CLAW, role: 'editor' }]);
      expect(service.checkPermission(doc, BOT_CLAW, ['editor'])).toBe(true);
    });

    it('should NOT match bot identity with different id', () => {
      const doc = makeDoc([{ identity: BOT_CLAW, role: 'editor' }]);
      expect(service.checkPermission(doc, BOT_OTHER, ['editor'])).toBe(false);
    });

    it('should NOT match user privilege against bot caller', () => {
      const doc = makeDoc([{ identity: USER_ALICE, role: 'owner' }]);
      expect(service.checkPermission(doc, BOT_CLAW, ['owner'])).toBe(false);
    });

    it('should NOT match bot privilege against user caller', () => {
      const doc = makeDoc([{ identity: BOT_CLAW, role: 'owner' }]);
      expect(service.checkPermission(doc, USER_ALICE, ['owner'])).toBe(false);
    });

    // workspace identity
    it('workspace(all) should match any user caller', () => {
      const doc = makeDoc([{ identity: WS_ALL, role: 'viewer' }]);
      expect(service.checkPermission(doc, USER_ALICE, ['viewer'])).toBe(true);
    });

    it('workspace(all) should match any bot caller', () => {
      const doc = makeDoc([{ identity: WS_ALL, role: 'viewer' }]);
      expect(service.checkPermission(doc, BOT_CLAW, ['viewer'])).toBe(true);
    });

    it('workspace(user) should match user callers', () => {
      const doc = makeDoc([{ identity: WS_USERS, role: 'suggester' }]);
      expect(service.checkPermission(doc, USER_BOB, ['suggester'])).toBe(true);
    });

    it('workspace(user) should NOT match bot callers', () => {
      const doc = makeDoc([{ identity: WS_USERS, role: 'suggester' }]);
      expect(service.checkPermission(doc, BOT_CLAW, ['suggester'])).toBe(false);
    });

    it('workspace(bot) should match bot callers', () => {
      const doc = makeDoc([{ identity: WS_BOTS, role: 'editor' }]);
      expect(service.checkPermission(doc, BOT_CLAW, ['editor'])).toBe(true);
    });

    it('workspace(bot) should NOT match user callers', () => {
      const doc = makeDoc([{ identity: WS_BOTS, role: 'editor' }]);
      expect(service.checkPermission(doc, USER_ALICE, ['editor'])).toBe(false);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // checkPermission — role logic
  // ────────────────────────────────────────────────────────────────

  describe('checkPermission — role matching', () => {
    it('should grant when role matches required roles', () => {
      const doc = makeDoc([{ identity: USER_ALICE, role: 'editor' }]);
      expect(
        service.checkPermission(doc, USER_ALICE, ['owner', 'editor']),
      ).toBe(true);
    });

    it('should deny when role does not match required roles', () => {
      const doc = makeDoc([{ identity: USER_ALICE, role: 'viewer' }]);
      expect(
        service.checkPermission(doc, USER_ALICE, ['owner', 'editor']),
      ).toBe(false);
    });

    it('should deny when privileges array is empty', () => {
      const doc = makeDoc([]);
      expect(service.checkPermission(doc, USER_ALICE, ['owner'])).toBe(false);
    });

    it('should check ALL privilege entries (first match wins)', () => {
      const doc = makeDoc([
        { identity: USER_BOB, role: 'owner' },
        { identity: USER_ALICE, role: 'viewer' },
        { identity: USER_ALICE, role: 'editor' },
      ]);
      // Alice has viewer AND editor, so editor should match
      expect(service.checkPermission(doc, USER_ALICE, ['editor'])).toBe(true);
    });

    it('multiple privileges: specific identity + workspace combined', () => {
      const doc = makeDoc([
        { identity: USER_ALICE, role: 'owner' },
        { identity: WS_BOTS, role: 'suggester' },
      ]);
      // Bot should get suggester through workspace rule
      expect(service.checkPermission(doc, BOT_CLAW, ['suggester'])).toBe(true);
      // Alice should get owner through specific identity
      expect(service.checkPermission(doc, USER_ALICE, ['owner'])).toBe(true);
      // Bob has no privilege entry
      expect(service.checkPermission(doc, USER_BOB, ['owner'])).toBe(false);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Role hierarchy scenarios (documenting expected behavior)
  // ────────────────────────────────────────────────────────────────

  describe('role hierarchy scenarios', () => {
    const ownerDoc = makeDoc([{ identity: USER_ALICE, role: 'owner' }]);
    const editorDoc = makeDoc([{ identity: USER_ALICE, role: 'editor' }]);
    const suggesterDoc = makeDoc([{ identity: USER_ALICE, role: 'suggester' }]);
    const viewerDoc = makeDoc([{ identity: USER_ALICE, role: 'viewer' }]);

    describe('owner can', () => {
      it('manage (owner-only operations)', () => {
        expect(service.checkPermission(ownerDoc, USER_ALICE, ['owner'])).toBe(
          true,
        );
      });
      it('edit (owner+editor operations)', () => {
        expect(
          service.checkPermission(ownerDoc, USER_ALICE, ['owner', 'editor']),
        ).toBe(true);
      });
      it('suggest (owner+editor+suggester operations)', () => {
        expect(
          service.checkPermission(ownerDoc, USER_ALICE, [
            'owner',
            'editor',
            'suggester',
          ]),
        ).toBe(true);
      });
      it('view (any role operations)', () => {
        expect(
          service.checkPermission(ownerDoc, USER_ALICE, [
            'owner',
            'editor',
            'suggester',
            'viewer',
          ]),
        ).toBe(true);
      });
    });

    describe('editor can', () => {
      it('NOT manage', () => {
        expect(service.checkPermission(editorDoc, USER_ALICE, ['owner'])).toBe(
          false,
        );
      });
      it('edit', () => {
        expect(
          service.checkPermission(editorDoc, USER_ALICE, ['owner', 'editor']),
        ).toBe(true);
      });
      it('suggest', () => {
        expect(
          service.checkPermission(editorDoc, USER_ALICE, [
            'owner',
            'editor',
            'suggester',
          ]),
        ).toBe(true);
      });
    });

    describe('suggester can', () => {
      it('NOT manage', () => {
        expect(
          service.checkPermission(suggesterDoc, USER_ALICE, ['owner']),
        ).toBe(false);
      });
      it('NOT edit', () => {
        expect(
          service.checkPermission(suggesterDoc, USER_ALICE, [
            'owner',
            'editor',
          ]),
        ).toBe(false);
      });
      it('suggest', () => {
        expect(
          service.checkPermission(suggesterDoc, USER_ALICE, [
            'owner',
            'editor',
            'suggester',
          ]),
        ).toBe(true);
      });
    });

    describe('viewer can', () => {
      it('NOT manage', () => {
        expect(service.checkPermission(viewerDoc, USER_ALICE, ['owner'])).toBe(
          false,
        );
      });
      it('NOT edit', () => {
        expect(
          service.checkPermission(viewerDoc, USER_ALICE, ['owner', 'editor']),
        ).toBe(false);
      });
      it('NOT suggest', () => {
        expect(
          service.checkPermission(viewerDoc, USER_ALICE, [
            'owner',
            'editor',
            'suggester',
          ]),
        ).toBe(false);
      });
      it('view', () => {
        expect(
          service.checkPermission(viewerDoc, USER_ALICE, [
            'owner',
            'editor',
            'suggester',
            'viewer',
          ]),
        ).toBe(true);
      });
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Permission enforcement in service methods
  // ────────────────────────────────────────────────────────────────

  describe('update() — permission enforcement', () => {
    it('should allow owner to update', async () => {
      const doc = makeDoc([{ identity: USER_ALICE, role: 'owner' }]);

      let limitCallCount = 0;
      db.limit.mockImplementation((() => {
        limitCallCount++;
        if (limitCallCount === 1) return Promise.resolve([doc]); // getDocOrThrow
        if (limitCallCount === 2) return Promise.resolve([{ versionIndex: 1 }]); // max version
        return Promise.resolve([]);
      }) as any);

      db.returning.mockResolvedValueOnce([
        {
          id: 'ver-2',
          documentId: 'doc-1',
          versionIndex: 2,
          content: 'updated',
          summary: null,
          updatedBy: USER_ALICE,
          createdAt: new Date(),
        },
      ]);

      const result = await service.update(
        'doc-1',
        { content: 'updated' },
        USER_ALICE,
      );
      expect(result.versionIndex).toBe(2);
    });

    it('should allow editor to update', async () => {
      const doc = makeDoc([{ identity: USER_BOB, role: 'editor' }]);

      let limitCallCount = 0;
      db.limit.mockImplementation((() => {
        limitCallCount++;
        if (limitCallCount === 1) return Promise.resolve([doc]);
        if (limitCallCount === 2) return Promise.resolve([{ versionIndex: 3 }]);
        return Promise.resolve([]);
      }) as any);

      db.returning.mockResolvedValueOnce([
        {
          id: 'ver-4',
          documentId: 'doc-1',
          versionIndex: 4,
          content: 'edited',
          summary: null,
          updatedBy: USER_BOB,
          createdAt: new Date(),
        },
      ]);

      const result = await service.update(
        'doc-1',
        { content: 'edited' },
        USER_BOB,
      );
      expect(result.versionIndex).toBe(4);
    });

    it('should reject suggester from updating', async () => {
      const doc = makeDoc([{ identity: USER_ALICE, role: 'suggester' }]);
      db.limit.mockResolvedValueOnce([doc]);

      await expect(
        service.update('doc-1', { content: 'nope' }, USER_ALICE),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject viewer from updating', async () => {
      const doc = makeDoc([{ identity: USER_ALICE, role: 'viewer' }]);
      db.limit.mockResolvedValueOnce([doc]);

      await expect(
        service.update('doc-1', { content: 'nope' }, USER_ALICE),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject unknown identity from updating', async () => {
      const doc = makeDoc([{ identity: USER_ALICE, role: 'owner' }]);
      db.limit.mockResolvedValueOnce([doc]);

      await expect(
        service.update('doc-1', { content: 'nope' }, USER_BOB),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('updatePrivileges() — owner-only enforcement', () => {
    it('should allow owner to update privileges', async () => {
      const doc = makeDoc([{ identity: USER_ALICE, role: 'owner' }]);
      db.limit.mockResolvedValueOnce([doc]);

      await expect(
        service.updatePrivileges(
          'doc-1',
          [
            { identity: USER_ALICE, role: 'owner' },
            { identity: WS_ALL, role: 'viewer' },
          ],
          USER_ALICE,
        ),
      ).resolves.toBeUndefined();

      expect(db.update).toHaveBeenCalled();
      expect(db.set).toHaveBeenCalledWith(
        expect.objectContaining({
          privileges: expect.arrayContaining([
            expect.objectContaining({ role: 'viewer' }),
          ]),
        }),
      );
    });

    it('should reject editor from updating privileges', async () => {
      const doc = makeDoc([{ identity: USER_ALICE, role: 'editor' }]);
      db.limit.mockResolvedValueOnce([doc]);

      await expect(
        service.updatePrivileges('doc-1', [], USER_ALICE),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject suggester from updating privileges', async () => {
      const doc = makeDoc([{ identity: BOT_CLAW, role: 'suggester' }]);
      db.limit.mockResolvedValueOnce([doc]);

      await expect(
        service.updatePrivileges('doc-1', [], BOT_CLAW),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('submitSuggestion() — permission enforcement', () => {
    const baseSuggestion = {
      id: 'sug-1',
      documentId: 'doc-1',
      fromVersionId: 'ver-1',
      suggestedBy: BOT_CLAW,
      data: { type: 'replace' as const, content: 'suggestion content' },
      summary: null,
      status: 'pending',
      reviewedBy: null,
      reviewedAt: null,
      resultVersionId: null,
      createdAt: new Date(),
    };

    it('should allow suggester to submit suggestion', async () => {
      const doc = makeDoc([{ identity: BOT_CLAW, role: 'suggester' }]);
      db.limit.mockResolvedValueOnce([doc]);
      db.returning.mockResolvedValueOnce([baseSuggestion]);

      const result = await service.submitSuggestion(
        'doc-1',
        { data: { type: 'replace', content: 'new content' } },
        BOT_CLAW,
      );
      expect(result.status).toBe('pending');
    });

    it('should allow editor to submit suggestion', async () => {
      const doc = makeDoc([{ identity: USER_ALICE, role: 'editor' }]);
      db.limit.mockResolvedValueOnce([doc]);
      db.returning.mockResolvedValueOnce([
        { ...baseSuggestion, suggestedBy: USER_ALICE },
      ]);

      const result = await service.submitSuggestion(
        'doc-1',
        { data: { type: 'replace', content: 'edit' } },
        USER_ALICE,
      );
      expect(result.status).toBe('pending');
    });

    it('should allow owner to submit suggestion', async () => {
      const doc = makeDoc([{ identity: USER_ALICE, role: 'owner' }]);
      db.limit.mockResolvedValueOnce([doc]);
      db.returning.mockResolvedValueOnce([
        { ...baseSuggestion, suggestedBy: USER_ALICE },
      ]);

      const result = await service.submitSuggestion(
        'doc-1',
        { data: { type: 'replace', content: 'edit' } },
        USER_ALICE,
      );
      expect(result.status).toBe('pending');
    });

    it('should reject viewer from submitting suggestion', async () => {
      const doc = makeDoc([{ identity: USER_ALICE, role: 'viewer' }]);
      db.limit.mockResolvedValueOnce([doc]);

      await expect(
        service.submitSuggestion(
          'doc-1',
          { data: { type: 'replace', content: 'nope' } },
          USER_ALICE,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject bot without any privilege from submitting suggestion', async () => {
      const doc = makeDoc([{ identity: USER_ALICE, role: 'owner' }]);
      db.limit.mockResolvedValueOnce([doc]);

      await expect(
        service.submitSuggestion(
          'doc-1',
          { data: { type: 'replace', content: 'nope' } },
          BOT_CLAW,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow bot through workspace(bot) suggester privilege', async () => {
      const doc = makeDoc([
        { identity: USER_ALICE, role: 'owner' },
        { identity: WS_BOTS, role: 'suggester' },
      ]);
      db.limit.mockResolvedValueOnce([doc]);
      db.returning.mockResolvedValueOnce([baseSuggestion]);

      const result = await service.submitSuggestion(
        'doc-1',
        { data: { type: 'replace', content: 'bot suggestion' } },
        BOT_CLAW,
      );
      expect(result.status).toBe('pending');
    });
  });

  describe('reviewSuggestion() — owner-only enforcement', () => {
    const pendingSuggestion = {
      id: 'sug-1',
      documentId: 'doc-1',
      fromVersionId: 'ver-1',
      suggestedBy: BOT_CLAW,
      data: { type: 'replace' as const, content: 'suggested content' },
      summary: 'A suggestion',
      status: 'pending' as const,
      reviewedBy: null,
      reviewedAt: null,
      resultVersionId: null,
      createdAt: new Date(),
    };

    it('should allow owner to reject suggestion', async () => {
      const doc = makeDoc([{ identity: USER_ALICE, role: 'owner' }]);

      let limitCallCount = 0;
      db.limit.mockImplementation((() => {
        limitCallCount++;
        if (limitCallCount === 1) return Promise.resolve([pendingSuggestion]); // getSuggestion
        if (limitCallCount === 2) return Promise.resolve([doc]); // getDocOrThrow
        return Promise.resolve([]);
      }) as any);

      db.returning.mockResolvedValueOnce([
        { ...pendingSuggestion, status: 'rejected', reviewedBy: USER_ALICE },
      ]);

      const result = await service.reviewSuggestion(
        'sug-1',
        'reject',
        USER_ALICE,
      );
      expect(result.status).toBe('rejected');
    });

    it('should allow owner to approve suggestion', async () => {
      const doc = makeDoc([{ identity: USER_ALICE, role: 'owner' }]);

      let limitCallCount = 0;
      db.limit.mockImplementation((() => {
        limitCallCount++;
        if (limitCallCount === 1) return Promise.resolve([pendingSuggestion]);
        if (limitCallCount === 2) return Promise.resolve([doc]);
        if (limitCallCount === 3) return Promise.resolve([{ versionIndex: 2 }]); // max version
        return Promise.resolve([]);
      }) as any);

      db.returning.mockResolvedValueOnce([
        {
          ...pendingSuggestion,
          status: 'approved',
          reviewedBy: USER_ALICE,
          resultVersionId: 'ver-new',
        },
      ]);

      const result = await service.reviewSuggestion(
        'sug-1',
        'approve',
        USER_ALICE,
      );
      expect(result.status).toBe('approved');
    });

    it('should reject editor from reviewing suggestion', async () => {
      const doc = makeDoc([{ identity: USER_ALICE, role: 'editor' }]);

      let limitCallCount = 0;
      db.limit.mockImplementation((() => {
        limitCallCount++;
        if (limitCallCount === 1) return Promise.resolve([pendingSuggestion]);
        if (limitCallCount === 2) return Promise.resolve([doc]);
        return Promise.resolve([]);
      }) as any);

      await expect(
        service.reviewSuggestion('sug-1', 'approve', USER_ALICE),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject bot from reviewing suggestion even with editor role', async () => {
      const doc = makeDoc([{ identity: BOT_CLAW, role: 'editor' }]);

      let limitCallCount = 0;
      db.limit.mockImplementation((() => {
        limitCallCount++;
        if (limitCallCount === 1) return Promise.resolve([pendingSuggestion]);
        if (limitCallCount === 2) return Promise.resolve([doc]);
        return Promise.resolve([]);
      }) as any);

      await expect(
        service.reviewSuggestion('sug-1', 'approve', BOT_CLAW),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject already-reviewed suggestion', async () => {
      const reviewedSuggestion = {
        ...pendingSuggestion,
        status: 'approved' as const,
        reviewedBy: USER_ALICE,
      };

      db.limit.mockResolvedValueOnce([reviewedSuggestion]);

      await expect(
        service.reviewSuggestion('sug-1', 'reject', USER_ALICE),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Edge cases
  // ────────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('should throw NotFoundException when document not found for update', async () => {
      db.limit.mockResolvedValueOnce([]);

      await expect(
        service.update('nonexistent', { content: 'x' }, USER_ALICE),
      ).rejects.toThrow(NotFoundException);
    });

    it('workspace(all) grants read but not write if role is viewer', () => {
      const doc = makeDoc([{ identity: WS_ALL, role: 'viewer' }]);
      // Can read (viewer is in the list)
      expect(
        service.checkPermission(doc, BOT_CLAW, [
          'owner',
          'editor',
          'suggester',
          'viewer',
        ]),
      ).toBe(true);
      // Cannot edit
      expect(service.checkPermission(doc, BOT_CLAW, ['owner', 'editor'])).toBe(
        false,
      );
      // Cannot manage
      expect(service.checkPermission(doc, BOT_CLAW, ['owner'])).toBe(false);
    });

    it('user with multiple privilege entries: highest effective role wins', () => {
      const doc = makeDoc([
        { identity: USER_ALICE, role: 'viewer' },
        { identity: WS_USERS, role: 'suggester' },
      ]);
      // Alice matches both: viewer (direct) + suggester (workspace)
      // For suggest check, workspace entry provides access
      expect(
        service.checkPermission(doc, USER_ALICE, [
          'owner',
          'editor',
          'suggester',
        ]),
      ).toBe(true);
      // For edit check, neither viewer nor suggester qualifies
      expect(
        service.checkPermission(doc, USER_ALICE, ['owner', 'editor']),
      ).toBe(false);
    });

    it('workspace(user) does not grant to workspace(bot) type callers', () => {
      const doc = makeDoc([{ identity: WS_USERS, role: 'editor' }]);
      // Bot should not match workspace(user)
      expect(service.checkPermission(doc, BOT_CLAW, ['editor'])).toBe(false);
      // User should match
      expect(service.checkPermission(doc, USER_ALICE, ['editor'])).toBe(true);
    });
  });
});

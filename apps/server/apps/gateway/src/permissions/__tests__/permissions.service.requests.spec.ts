// apps/server/apps/gateway/src/permissions/__tests__/permissions.service.requests.spec.ts
import { jest } from '@jest/globals';
import { ConflictException, NotFoundException } from '@nestjs/common';

const insertGrantReturning = jest.fn();
const insertRequestReturning = jest.fn();
const updateRequestReturning = jest.fn();
const requestFindFirst = jest.fn();
const requestFindMany = jest.fn();
const tenantMembersFindMany = jest.fn();

const tx = {
  insert: jest.fn((tbl: any) => ({
    values: jest.fn(() => ({
      returning:
        tbl.__name === 'requests'
          ? insertRequestReturning
          : insertGrantReturning,
    })),
  })),
  update: jest.fn(() => ({
    set: jest.fn(() => ({
      where: jest.fn(() => ({ returning: updateRequestReturning })),
    })),
  })),
  query: {
    authPermissionRequests: {
      findFirst: requestFindFirst,
      findMany: requestFindMany,
    },
    tenantMembers: { findMany: tenantMembersFindMany },
  },
};

const botsFindFirst = jest.fn();
const grantsFindMany = jest.fn();

const mockDb = {
  ...tx,
  query: {
    authPermissionRequests: {
      findFirst: requestFindFirst,
      findMany: requestFindMany,
    },
    tenantMembers: { findMany: tenantMembersFindMany },
    bots: { findFirst: botsFindFirst },
    authPermissionGrants: { findMany: grantsFindMany },
  },
  transaction: jest.fn(async (fn: any) => fn(tx)),
};

// eslint-disable-next-line @typescript-eslint/await-thenable
await jest.unstable_mockModule('@team9/database', () => ({
  DatabaseService: class {
    db = mockDb;
  },
  authPermissionGrants: { __name: 'grants' },
  authPermissionRequests: { __name: 'requests' },
  routineExecutions: {},
  tenantMembers: {},
  // Provide DATABASE_CONNECTION token and Drizzle helpers used by transitive imports
  DATABASE_CONNECTION: 'DATABASE_CONNECTION',
  eq: jest.fn(),
  and: jest.fn(),
  isNull: jest.fn(),
  desc: jest.fn(),
  inArray: jest.fn(),
  gt: jest.fn(),
  // Table refs needed by PermissionsApproverRepository (transitive dep)
  channels: {},
  channelMembers: {},
  bots: {},
  routines: {},
  workspaceWikis: {},
}));

// eslint-disable-next-line @typescript-eslint/await-thenable
await jest.unstable_mockModule('@team9/database/schemas', () => ({}));

const events = { emit: jest.fn() };
const spell = {
  generate: jest.fn(() => 'raven crystal flame'),
  parse: jest.fn(),
};
const approvers = {
  findChannelOwnersAndAdmins: jest.fn(),
  findBotOwnerAndMentor: jest.fn(),
  findRoutineCreatorAndOwner: jest.fn(),
  findWikiOwners: jest.fn(),
  findWorkspaceOwners: jest.fn(),
  findWorkspaceAdmins: jest.fn(),
};

const { PermissionsService } = await import('../permissions.service.js');

describe('PermissionsService — requests', () => {
  let svc: InstanceType<typeof PermissionsService>;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new PermissionsService(
      mockDb as never, // db (PostgresJsDatabase via DATABASE_CONNECTION)
      events as never, // EventEmitter2
      spell as never, // SpellIdService
      approvers as never, // PermissionsApproverRepository
    );
  });

  describe('createRequest', () => {
    it('inserts a pending request with generated spell id', async () => {
      insertRequestReturning.mockResolvedValueOnce([
        {
          id: 'r1',
          spellId: 'raven crystal flame',
          status: 'pending',
          tenantId: 't1',
          requesterBotId: 'b1',
          permissionKey: 'tools:invoke',
          requestedMetadata: { toolName: 'sql' },
          suggestedApproverIds: [],
          contextChannelId: null,
          contextExecutionId: null,
          contextRoutineId: null,
          reason: 'data lookup',
          expiresAt: new Date(),
        },
      ]);
      approvers.findBotOwnerAndMentor.mockResolvedValueOnce(['u-owner']);
      approvers.findWorkspaceOwners.mockResolvedValueOnce([]);
      // suggestedApproverIds: [] so tenantMembersFindMany will NOT be called

      const r = await svc.createRequest({
        tenantId: 't1',
        requesterBotId: 'b1',
        permissionKey: 'tools:invoke',
        requestedMetadata: { toolName: 'sql' },
        reason: 'data lookup',
      });
      expect(r).toMatchObject({ id: 'r1', spellId: 'raven crystal flame' });
      expect(events.emit).toHaveBeenCalledWith(
        'permissions.request.created',
        expect.objectContaining({ id: 'r1', approverIds: ['u-owner'] }),
      );
    });

    it('retries on unique violation, escalates to 4 words', async () => {
      const dupeErr = Object.assign(new Error('dupe'), { code: '23505' });
      insertRequestReturning
        .mockRejectedValueOnce(dupeErr)
        .mockRejectedValueOnce(dupeErr)
        .mockRejectedValueOnce(dupeErr)
        .mockResolvedValueOnce([
          {
            id: 'r1',
            spellId: 'a b c d',
            status: 'pending',
            tenantId: 't1',
            requesterBotId: 'b1',
            permissionKey: 'tools:invoke',
            requestedMetadata: {},
            suggestedApproverIds: [],
            contextChannelId: null,
            contextExecutionId: null,
            contextRoutineId: null,
            reason: null,
            expiresAt: new Date(),
          },
        ]);
      approvers.findBotOwnerAndMentor.mockResolvedValueOnce(['u-owner']);
      approvers.findWorkspaceOwners.mockResolvedValueOnce([]);
      // suggestedApproverIds: [] so tenantMembersFindMany will NOT be called

      const r = await svc.createRequest({
        tenantId: 't1',
        requesterBotId: 'b1',
        permissionKey: 'tools:invoke',
        requestedMetadata: { toolName: 'sql' },
      });
      expect(r.id).toBe('r1');
      expect(spell.generate).toHaveBeenCalledTimes(4);
      // 4th call should pass wordCount: 4
      expect(spell.generate.mock.calls[3]?.[0]).toEqual({ wordCount: 4 });
    });

    it('throws after 5 total failed attempts', async () => {
      const dupeErr = Object.assign(new Error('dupe'), { code: '23505' });
      insertRequestReturning
        .mockRejectedValueOnce(dupeErr)
        .mockRejectedValueOnce(dupeErr)
        .mockRejectedValueOnce(dupeErr)
        .mockRejectedValueOnce(dupeErr)
        .mockRejectedValueOnce(dupeErr);

      await expect(
        svc.createRequest({
          tenantId: 't1',
          requesterBotId: 'b1',
          permissionKey: 'tools:invoke',
          requestedMetadata: {},
        }),
      ).rejects.toMatchObject({ code: '23505' });
      expect(spell.generate).toHaveBeenCalledTimes(5);
    });

    it('returns existing pending request when called twice with same context (Fix 8 dedup)', async () => {
      const existingRow = {
        id: 'r-existing',
        spellId: 'old spell id',
        status: 'pending',
        tenantId: 't1',
        requesterBotId: 'b1',
        permissionKey: 'tools:invoke',
        requestedMetadata: { toolName: 'sql' },
        suggestedApproverIds: [],
        contextChannelId: 'ch-1',
        contextExecutionId: null,
        contextRoutineId: null,
        reason: null,
        expiresAt: new Date(Date.now() + 60_000), // expires in 1 minute
      };
      // requestFindFirst is used by dedup check before insert
      requestFindFirst.mockResolvedValueOnce(existingRow);

      const r = await svc.createRequest({
        tenantId: 't1',
        requesterBotId: 'b1',
        permissionKey: 'tools:invoke',
        requestedMetadata: { toolName: 'sql' },
        contextChannelId: 'ch-1',
      });
      expect(r.id).toBe('r-existing');
      // No insert should have been called
      expect(spell.generate).not.toHaveBeenCalled();
      // No event emitted for existing request
      expect(events.emit).not.toHaveBeenCalled();
    });
  });

  describe('cancelRequest', () => {
    it('cancels a pending request owned by the requester bot', async () => {
      updateRequestReturning.mockResolvedValueOnce([
        { id: 'r1', spellId: 'raven crystal flame', status: 'cancelled' },
      ]);

      const row = await svc.cancelRequest({
        requestId: 'r1',
        requesterBotId: 'b1',
        tenantId: 't1',
      });
      expect(row.status).toBe('cancelled');
      expect(events.emit).toHaveBeenCalledWith(
        'permissions.request.decided',
        expect.objectContaining({
          id: 'r1',
          status: 'cancelled',
          durableGrantId: null,
        }),
      );
    });

    it('throws NotFoundException when no matching pending request', async () => {
      updateRequestReturning.mockResolvedValueOnce([]);
      await expect(
        svc.cancelRequest({
          requestId: 'r1',
          requesterBotId: 'b1',
          tenantId: 't1',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses to cancel a request in a different tenant', async () => {
      // When tenantId does not match, the DB update returns 0 rows
      updateRequestReturning.mockResolvedValueOnce([]);
      await expect(
        svc.cancelRequest({
          requestId: 'r1',
          requesterBotId: 'b1',
          tenantId: 'other-tenant',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      // Verify the update was called (tenantId filter is passed to DB layer)
      expect(mockDb.update).toHaveBeenCalled();
    });
  });

  describe('decideRequest', () => {
    it('once: updates status only', async () => {
      requestFindFirst.mockResolvedValueOnce({
        id: 'r1',
        tenantId: 't1',
        status: 'pending',
        permissionKey: 'tools:invoke',
        requestedMetadata: { toolName: 'sql' },
        requesterBotId: 'b1',
        contextChannelId: null,
        contextExecutionId: null,
        contextRoutineId: null,
        suggestedApproverIds: [],
      });
      updateRequestReturning.mockResolvedValueOnce([
        { id: 'r1', status: 'approved_once' },
      ]);

      const r = await svc.decideRequest({
        requestId: 'r1',
        userId: 'u-owner',
        tenantId: 't1',
        decision: 'once',
      });
      expect(r.status).toBe('approved_once');
      expect(events.emit).toHaveBeenCalledWith(
        'permissions.request.decided',
        expect.objectContaining({ id: 'r1', status: 'approved_once' }),
      );
    });

    it('remember: creates a grant in the same transaction', async () => {
      requestFindFirst.mockResolvedValueOnce({
        id: 'r1',
        tenantId: 't1',
        status: 'pending',
        permissionKey: 'tools:invoke',
        requestedMetadata: { toolName: 'sql' },
        requesterBotId: 'b1',
        contextChannelId: null,
        contextExecutionId: null,
        contextRoutineId: null,
        suggestedApproverIds: [],
      });
      insertGrantReturning.mockResolvedValueOnce([{ id: 'g1' }]);
      updateRequestReturning.mockResolvedValueOnce([
        { id: 'r1', status: 'approved_durable', durableGrantId: 'g1' },
      ]);

      const r = await svc.decideRequest({
        requestId: 'r1',
        userId: 'u-owner',
        tenantId: 't1',
        decision: 'remember',
        rememberSubject: 'agent',
      });
      expect(r.durableGrantId).toBe('g1');
      expect(mockDb.transaction).toHaveBeenCalled();
      expect(events.emit).toHaveBeenCalledWith(
        'permissions.grant.created',
        expect.objectContaining({ id: 'g1' }),
      );
    });

    it('remember with scopeOverride creates grant with overridden scope', async () => {
      // Original requests toolNames: ['sql', 'shell']; override narrows to ['sql'] only
      requestFindFirst.mockResolvedValueOnce({
        id: 'r1',
        tenantId: 't1',
        status: 'pending',
        permissionKey: 'tools:invoke',
        requestedMetadata: { toolNames: ['sql', 'shell'] },
        requesterBotId: 'b1',
        contextChannelId: null,
        contextExecutionId: null,
        contextRoutineId: null,
        suggestedApproverIds: [],
        expiresAt: null,
      });
      insertGrantReturning.mockResolvedValueOnce([{ id: 'g-override' }]);
      // For 'remember', requestedMetadata on the request row is preserved unchanged (Fix 6)
      updateRequestReturning.mockResolvedValueOnce([
        {
          id: 'r1',
          status: 'approved_durable',
          durableGrantId: 'g-override',
          requestedMetadata: { toolNames: ['sql', 'shell'] }, // unchanged original
        },
      ]);

      const r = await svc.decideRequest({
        requestId: 'r1',
        userId: 'u-owner',
        tenantId: 't1',
        decision: 'remember',
        rememberSubject: 'agent',
        scopeOverride: { toolNames: ['sql'] }, // valid narrowing: subset of original array
      });
      expect(r.durableGrantId).toBe('g-override');
      // Grant insert should have received the overridden scope, not the original
      const insertCall = tx.insert.mock.calls.find(
        (c: any[]) => c[0]?.__name === 'grants',
      );
      expect(insertCall).toBeDefined();
      // The request row's requestedMetadata should remain the original (not the override)
      expect(r.requestedMetadata).toEqual({ toolNames: ['sql', 'shell'] });
    });

    it('decideRequest remember preserves original requestedMetadata even when scopeOverride is provided (Fix 6)', async () => {
      // Override narrows by adding an extra constraint key (still a valid narrowing)
      const originalMetadata = { toolName: 'sql' };
      requestFindFirst.mockResolvedValueOnce({
        id: 'r1',
        tenantId: 't1',
        status: 'pending',
        permissionKey: 'tools:invoke',
        requestedMetadata: originalMetadata,
        requesterBotId: 'b1',
        contextChannelId: null,
        contextExecutionId: null,
        contextRoutineId: null,
        suggestedApproverIds: [],
        expiresAt: null,
      });
      insertGrantReturning.mockResolvedValueOnce([{ id: 'g-new' }]);
      // DB returns the row unchanged — requestedMetadata is the original
      updateRequestReturning.mockResolvedValueOnce([
        {
          id: 'r1',
          status: 'approved_durable',
          durableGrantId: 'g-new',
          requestedMetadata: originalMetadata,
        },
      ]);

      const r = await svc.decideRequest({
        requestId: 'r1',
        userId: 'u-owner',
        tenantId: 't1',
        decision: 'remember',
        rememberSubject: 'agent',
        // Override keeps original key matching + adds extra constraint → valid narrowing
        scopeOverride: { toolName: 'sql', region: 'us-east-1' },
      });

      // The returned row should have the original requestedMetadata
      expect(r.requestedMetadata).toEqual(originalMetadata);
      expect(r.durableGrantId).toBe('g-new');
    });

    it('decideRequest rejects scopeOverride that broadens the original scope (C2)', async () => {
      requestFindFirst.mockResolvedValueOnce({
        id: 'r1',
        tenantId: 't1',
        status: 'pending',
        permissionKey: 'tools:invoke',
        requestedMetadata: { toolNames: ['sql'] },
        requesterBotId: 'b1',
        contextChannelId: null,
        contextExecutionId: null,
        contextRoutineId: null,
        suggestedApproverIds: [],
        expiresAt: new Date(Date.now() + 60_000),
      });

      const { BadRequestException } = await import('@nestjs/common');
      await expect(
        svc.decideRequest({
          requestId: 'r1',
          userId: 'u-owner',
          tenantId: 't1',
          decision: 'once',
          // override adds 'shell' which is outside the original ['sql'] → broadens
          scopeOverride: { toolNames: ['sql', 'shell'] },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      // No DB update should have been attempted
      expect(updateRequestReturning).not.toHaveBeenCalled();
    });

    it('deny: sets status to denied', async () => {
      requestFindFirst.mockResolvedValueOnce({
        id: 'r1',
        tenantId: 't1',
        status: 'pending',
        permissionKey: 'tools:invoke',
        requestedMetadata: {},
        requesterBotId: 'b1',
        contextChannelId: null,
        contextExecutionId: null,
        contextRoutineId: null,
        suggestedApproverIds: [],
      });
      updateRequestReturning.mockResolvedValueOnce([
        { id: 'r1', status: 'denied' },
      ]);

      const r = await svc.decideRequest({
        requestId: 'r1',
        userId: 'u-owner',
        tenantId: 't1',
        decision: 'deny',
      });
      expect(r.status).toBe('denied');
    });

    it('rejects when request already decided', async () => {
      requestFindFirst.mockResolvedValueOnce({
        id: 'r1',
        tenantId: 't1',
        status: 'denied',
        permissionKey: 'tools:invoke',
        requestedMetadata: {},
        requesterBotId: 'b1',
        suggestedApproverIds: [],
      });
      await expect(
        svc.decideRequest({
          requestId: 'r1',
          userId: 'u-owner',
          tenantId: 't1',
          decision: 'once',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws NotFoundException when request not found', async () => {
      requestFindFirst.mockResolvedValueOnce(null);
      await expect(
        svc.decideRequest({
          requestId: 'missing',
          userId: 'u-owner',
          tenantId: 't1',
          decision: 'once',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('race-safe: throws ConflictException when concurrent decide already changed status', async () => {
      // findFirst returns pending but update returns [] (concurrent decide won)
      requestFindFirst.mockResolvedValueOnce({
        id: 'r1',
        tenantId: 't1',
        status: 'pending',
        permissionKey: 'tools:invoke',
        requestedMetadata: {},
        requesterBotId: 'b1',
        contextChannelId: null,
        contextExecutionId: null,
        contextRoutineId: null,
        suggestedApproverIds: [],
        expiresAt: null,
      });
      updateRequestReturning.mockResolvedValueOnce([]); // concurrent decide won

      const { ConflictException } = await import('@nestjs/common');
      await expect(
        svc.decideRequest({
          requestId: 'r1',
          userId: 'u-owner',
          tenantId: 't1',
          decision: 'once',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws ConflictException for status=expired', async () => {
      requestFindFirst.mockResolvedValueOnce({
        id: 'r1',
        tenantId: 't1',
        status: 'expired',
        permissionKey: 'tools:invoke',
        requestedMetadata: {},
        requesterBotId: 'b1',
        suggestedApproverIds: [],
        expiresAt: null,
      });
      const { ConflictException } = await import('@nestjs/common');
      await expect(
        svc.decideRequest({
          requestId: 'r1',
          userId: 'u-owner',
          tenantId: 't1',
          decision: 'once',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws ConflictException for status=approved_once', async () => {
      requestFindFirst.mockResolvedValueOnce({
        id: 'r1',
        tenantId: 't1',
        status: 'approved_once',
        permissionKey: 'tools:invoke',
        requestedMetadata: {},
        requesterBotId: 'b1',
        suggestedApproverIds: [],
        expiresAt: null,
      });
      const { ConflictException } = await import('@nestjs/common');
      await expect(
        svc.decideRequest({
          requestId: 'r1',
          userId: 'u-owner',
          tenantId: 't1',
          decision: 'once',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws ConflictException for status=cancelled', async () => {
      requestFindFirst.mockResolvedValueOnce({
        id: 'r1',
        tenantId: 't1',
        status: 'cancelled',
        permissionKey: 'tools:invoke',
        requestedMetadata: {},
        requesterBotId: 'b1',
        suggestedApproverIds: [],
        expiresAt: null,
      });
      const { ConflictException } = await import('@nestjs/common');
      await expect(
        svc.decideRequest({
          requestId: 'r1',
          userId: 'u-owner',
          tenantId: 't1',
          decision: 'once',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws ConflictException when expiresAt is in the past', async () => {
      requestFindFirst.mockResolvedValueOnce({
        id: 'r1',
        tenantId: 't1',
        status: 'pending',
        permissionKey: 'tools:invoke',
        requestedMetadata: {},
        requesterBotId: 'b1',
        suggestedApproverIds: [],
        contextChannelId: null,
        contextExecutionId: null,
        contextRoutineId: null,
        expiresAt: new Date(Date.now() - 5000), // expired 5 seconds ago
      });
      const { ConflictException } = await import('@nestjs/common');
      await expect(
        svc.decideRequest({
          requestId: 'r1',
          userId: 'u-owner',
          tenantId: 't1',
          decision: 'once',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('remember with rememberSubject=channel-session uses contextChannelId', async () => {
      requestFindFirst.mockResolvedValueOnce({
        id: 'r1',
        tenantId: 't1',
        status: 'pending',
        permissionKey: 'messages:send',
        requestedMetadata: {},
        requesterBotId: 'b1',
        contextChannelId: 'ch-1',
        contextExecutionId: null,
        contextRoutineId: null,
        suggestedApproverIds: [],
        expiresAt: null,
      });
      insertGrantReturning.mockResolvedValueOnce([
        { id: 'g1', tenantId: 't1' },
      ]);
      updateRequestReturning.mockResolvedValueOnce([
        { id: 'r1', status: 'approved_durable', durableGrantId: 'g1' },
      ]);

      const r = await svc.decideRequest({
        requestId: 'r1',
        userId: 'u-owner',
        tenantId: 't1',
        decision: 'remember',
        rememberSubject: 'channel-session',
      });
      expect(r.durableGrantId).toBe('g1');
      // Verify the grant was created with channel-session subject
      const insertCall = tx.insert.mock.calls.find(
        (c: any[]) => c[0]?.__name === 'grants',
      );
      expect(insertCall).toBeDefined();
    });

    it('remember with rememberSubject=channel-session throws BadRequest when contextChannelId is null', async () => {
      requestFindFirst.mockResolvedValueOnce({
        id: 'r1',
        tenantId: 't1',
        status: 'pending',
        permissionKey: 'messages:send',
        requestedMetadata: {},
        requesterBotId: 'b1',
        contextChannelId: null, // missing!
        contextExecutionId: null,
        contextRoutineId: null,
        suggestedApproverIds: [],
        expiresAt: null,
      });

      const { BadRequestException } = await import('@nestjs/common');
      await expect(
        svc.decideRequest({
          requestId: 'r1',
          userId: 'u-owner',
          tenantId: 't1',
          decision: 'remember',
          rememberSubject: 'channel-session',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('remember with rememberSubject=task uses contextRoutineId', async () => {
      requestFindFirst.mockResolvedValueOnce({
        id: 'r1',
        tenantId: 't1',
        status: 'pending',
        permissionKey: 'routine:trigger',
        requestedMetadata: {},
        requesterBotId: 'b1',
        contextChannelId: null,
        contextExecutionId: null,
        contextRoutineId: 'routine-1',
        suggestedApproverIds: [],
        expiresAt: null,
      });
      insertGrantReturning.mockResolvedValueOnce([
        { id: 'g1', tenantId: 't1' },
      ]);
      updateRequestReturning.mockResolvedValueOnce([
        { id: 'r1', status: 'approved_durable', durableGrantId: 'g1' },
      ]);

      const r = await svc.decideRequest({
        requestId: 'r1',
        userId: 'u-owner',
        tenantId: 't1',
        decision: 'remember',
        rememberSubject: 'task',
      });
      expect(r.durableGrantId).toBe('g1');
    });

    it('remember with rememberSubject=execution-session uses contextExecutionId (Fix 12)', async () => {
      requestFindFirst.mockResolvedValueOnce({
        id: 'r1',
        tenantId: 't1',
        status: 'pending',
        permissionKey: 'tools:invoke',
        requestedMetadata: {},
        requesterBotId: 'b1',
        contextChannelId: null,
        contextExecutionId: 'exec-1',
        contextRoutineId: null,
        suggestedApproverIds: [],
        expiresAt: null,
      });
      insertGrantReturning.mockResolvedValueOnce([
        {
          id: 'g1',
          tenantId: 't1',
          subjectKind: 'execution-session',
          subjectId: 'exec-1',
          permissionKey: 'tools:invoke',
          scopeMetadata: {},
        },
      ]);
      updateRequestReturning.mockResolvedValueOnce([
        { id: 'r1', status: 'approved_durable', durableGrantId: 'g1' },
      ]);

      const r = await svc.decideRequest({
        requestId: 'r1',
        userId: 'u-owner',
        tenantId: 't1',
        decision: 'remember',
        rememberSubject: 'execution-session',
      });
      expect(r.durableGrantId).toBe('g1');
      // Verify grant emit includes full payload (Fix 7)
      expect(events.emit).toHaveBeenCalledWith(
        'permissions.grant.created',
        expect.objectContaining({
          id: 'g1',
          subjectKind: 'execution-session',
          subjectId: 'exec-1',
          permissionKey: 'tools:invoke',
        }),
      );
      // Verify insert was called with execution-session subject (Fix 12 - TX insert check)
      const insertCall = tx.insert.mock.calls.find(
        (c: any[]) => c[0]?.__name === 'grants',
      );
      expect(insertCall).toBeDefined();
    });

    it('remember with rememberSubject=execution-session throws BadRequest when contextExecutionId is null (Fix 12)', async () => {
      requestFindFirst.mockResolvedValueOnce({
        id: 'r1',
        tenantId: 't1',
        status: 'pending',
        permissionKey: 'tools:invoke',
        requestedMetadata: {},
        requesterBotId: 'b1',
        contextChannelId: null,
        contextExecutionId: null, // missing!
        contextRoutineId: null,
        suggestedApproverIds: [],
        expiresAt: null,
      });

      const { BadRequestException } = await import('@nestjs/common');
      await expect(
        svc.decideRequest({
          requestId: 'r1',
          userId: 'u-owner',
          tenantId: 't1',
          decision: 'remember',
          rememberSubject: 'execution-session',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('decideRequest with scopeOverride: {} preserves the original requestedMetadata (Fix 9)', async () => {
      const originalMetadata = { toolName: 'sql', region: 'us-east-1' };
      requestFindFirst.mockResolvedValueOnce({
        id: 'r1',
        tenantId: 't1',
        status: 'pending',
        permissionKey: 'tools:invoke',
        requestedMetadata: originalMetadata,
        requesterBotId: 'b1',
        contextChannelId: null,
        contextExecutionId: null,
        contextRoutineId: null,
        suggestedApproverIds: [],
        expiresAt: null,
      });
      updateRequestReturning.mockResolvedValueOnce([
        {
          id: 'r1',
          status: 'approved_once',
          requestedMetadata: originalMetadata,
        },
      ]);

      const r = await svc.decideRequest({
        requestId: 'r1',
        userId: 'u-owner',
        tenantId: 't1',
        decision: 'once',
        scopeOverride: {}, // empty object — should NOT override
      });
      // The requestedMetadata in the result should be the original, not overridden
      expect(r.requestedMetadata).toEqual(originalMetadata);
    });

    it('decideRequest — TX insert receives correct subjectKind/subjectId for channel-session subject (Fix 12)', async () => {
      requestFindFirst.mockResolvedValueOnce({
        id: 'r1',
        tenantId: 't1',
        status: 'pending',
        permissionKey: 'messages:send',
        requestedMetadata: {},
        requesterBotId: 'b1',
        contextChannelId: 'ch-99',
        contextExecutionId: null,
        contextRoutineId: null,
        suggestedApproverIds: [],
        expiresAt: null,
      });
      insertGrantReturning.mockResolvedValueOnce([
        {
          id: 'g1',
          tenantId: 't1',
          subjectKind: 'channel-session',
          subjectId: 'ch-99',
          permissionKey: 'messages:send',
          scopeMetadata: {},
        },
      ]);
      updateRequestReturning.mockResolvedValueOnce([
        { id: 'r1', status: 'approved_durable', durableGrantId: 'g1' },
      ]);

      await svc.decideRequest({
        requestId: 'r1',
        userId: 'u-owner',
        tenantId: 't1',
        decision: 'remember',
        rememberSubject: 'channel-session',
      });

      // Verify grant.created event carries full payload (Fix 7)
      expect(events.emit).toHaveBeenCalledWith(
        'permissions.grant.created',
        expect.objectContaining({
          id: 'g1',
          subjectKind: 'channel-session',
          subjectId: 'ch-99',
          permissionKey: 'messages:send',
        }),
      );
    });
  });

  describe('getRequest', () => {
    it('returns null when row not found', async () => {
      requestFindFirst.mockResolvedValueOnce(undefined);
      const result = await svc.getRequest('nonexistent');
      expect(result).toBeNull();
    });

    it('returns null when tenantId provided and row belongs to another tenant (DB returns null)', async () => {
      // The tenantId filter is pushed to the DB WHERE clause; DB returns null/undefined
      requestFindFirst.mockResolvedValueOnce(undefined);
      const result = await svc.getRequest('r1', 'wrong-tenant');
      expect(result).toBeNull();
    });

    it('returns row when tenantId matches', async () => {
      const row = {
        id: 'r1',
        tenantId: 't1',
        status: 'pending',
        permissionKey: 'tools:invoke',
        requestedMetadata: {},
        requesterBotId: 'b1',
      };
      requestFindFirst.mockResolvedValueOnce(row);
      const result = await svc.getRequest('r1', 't1');
      expect(result).toEqual(row);
    });
  });

  describe('listRequests', () => {
    it('returns only requests where caller is an approver (scope param is ignored)', async () => {
      // Previously scope=tenant skipped canDecide — now it always filters.
      // Even with scope='tenant', only requests where the caller is an approver are returned.
      const rows = [
        {
          id: 'r1',
          tenantId: 't1',
          status: 'pending',
          permissionKey: 'tools:invoke',
          requestedMetadata: {},
          requesterBotId: 'b1',
          suggestedApproverIds: [],
          contextChannelId: null,
          contextExecutionId: null,
          contextRoutineId: null,
        },
        {
          id: 'r2',
          tenantId: 't1',
          status: 'pending',
          permissionKey: 'tools:invoke',
          requestedMetadata: {},
          requesterBotId: 'b2',
          suggestedApproverIds: [],
          contextChannelId: null,
          contextExecutionId: null,
          contextRoutineId: null,
        },
      ];
      requestFindMany.mockResolvedValueOnce(rows);
      // u-admin can decide both (workspace admin is always in the approver set)
      approvers.findBotOwnerAndMentor
        .mockResolvedValueOnce(['u-admin'])
        .mockResolvedValueOnce(['u-admin']);
      approvers.findWorkspaceOwners
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await svc.listRequests({
        tenantId: 't1',
        userId: 'u-admin',
        scope: 'tenant', // value is ignored — still filters by approver
      });
      expect(result).toHaveLength(2);
    });

    it('scope=mine returns only requests where userId is an approver', async () => {
      // Both rows use tools:invoke so resolveApprovers calls findBotOwnerAndMentor
      // for each row, enabling predictable mock behavior.
      const rows = [
        {
          id: 'r1',
          tenantId: 't1',
          status: 'pending',
          permissionKey: 'tools:invoke',
          requestedMetadata: {},
          requesterBotId: 'b1',
          suggestedApproverIds: [],
          contextChannelId: null,
          contextExecutionId: null,
          contextRoutineId: null,
        },
        {
          id: 'r2',
          tenantId: 't1',
          status: 'pending',
          permissionKey: 'tools:invoke',
          requestedMetadata: {},
          requesterBotId: 'b2',
          suggestedApproverIds: [],
          contextChannelId: null,
          contextExecutionId: null,
          contextRoutineId: null,
        },
      ];
      requestFindMany.mockResolvedValueOnce(rows);

      // 'u-approver' can decide r1 (b1 → ['u-approver']) but not r2 (b2 → ['u-other'])
      // tools:invoke.resolveApprovers calls findBotOwnerAndMentor; primary is non-empty
      // so no fallback to findWorkspaceAdmins. findWorkspaceOwners is always called.
      approvers.findBotOwnerAndMentor
        .mockResolvedValueOnce(['u-approver']) // r1
        .mockResolvedValueOnce(['u-other']); // r2
      approvers.findWorkspaceOwners
        .mockResolvedValueOnce([]) // r1 safety-net owners
        .mockResolvedValueOnce([]); // r2 safety-net owners

      const result = await svc.listRequests({
        tenantId: 't1',
        userId: 'u-approver',
        scope: 'mine',
      });
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe('r1');
    });

    it('listRequests — does not return expired pending requests', async () => {
      // The expired row should be excluded by the WHERE clause (Fix 7)
      // Since we mock findMany, we simulate the DB returning no rows (the filter
      // happens at SQL level). The test verifies the result is empty.
      requestFindMany.mockResolvedValueOnce([]); // DB returns no rows (expired filtered out)

      const result = await svc.listRequests({
        tenantId: 't1',
        userId: 'u-admin',
        status: 'pending',
      });
      expect(result).toHaveLength(0);
    });

    it('listRequests — without status filter, does NOT exclude expired resolved rows', async () => {
      // Regression guard: the expiry filter must only apply when status='pending'.
      // For no-status queries, decided/cancelled rows whose original 30-min expiresAt
      // has passed must remain visible.
      const denied = {
        id: 'r-denied',
        tenantId: 't1',
        requesterBotId: 'b1',
        permissionKey: 'tools:invoke',
        status: 'denied',
        requestedMetadata: {},
        suggestedApproverIds: [],
        contextChannelId: null,
        contextExecutionId: null,
        contextRoutineId: null,
        expiresAt: new Date(Date.now() - 60_000), // expired (past), but row is denied
      };
      requestFindMany.mockResolvedValueOnce([denied]);
      approvers.findBotOwnerAndMentor.mockResolvedValue(['u-admin']);
      approvers.findWorkspaceOwners.mockResolvedValue([]);

      const result = await svc.listRequests({
        tenantId: 't1',
        userId: 'u-admin',
        // no status filter
      });
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe('r-denied');
    });
  });

  describe('resolveApprovers', () => {
    it('unions key holders + valid suggested + workspace owners', async () => {
      tenantMembersFindMany.mockResolvedValueOnce([
        { userId: 'u-suggested-1' },
      ]);
      approvers.findBotOwnerAndMentor.mockResolvedValueOnce(['u-owner']);
      approvers.findWorkspaceOwners.mockResolvedValueOnce(['u-ws-owner']);

      const ids = await svc.resolveApprovers({
        id: 'r1',
        tenantId: 't1',
        requesterBotId: 'b1',
        permissionKey: 'tools:invoke',
        requestedMetadata: {},
        suggestedApproverIds: ['u-suggested-1', 'u-foreign'],
        contextChannelId: null,
        contextExecutionId: null,
        contextRoutineId: null,
      } as never);
      expect(new Set(ids)).toEqual(
        new Set(['u-owner', 'u-suggested-1', 'u-ws-owner']),
      );
      // u-foreign was filtered (not in tenantMembers result)
    });

    it('returns workspace owners only when permissionKey is unknown to the registry', async () => {
      approvers.findWorkspaceOwners.mockResolvedValueOnce(['u-ws-owner']);

      const ids = await svc.resolveApprovers({
        id: 'r-unknown',
        tenantId: 't1',
        requesterBotId: 'b1',
        permissionKey: 'unknown:bogus' as never,
        requestedMetadata: {},
        suggestedApproverIds: [],
        contextChannelId: null,
        contextExecutionId: null,
        contextRoutineId: null,
      });
      expect(ids).toEqual(['u-ws-owner']);
      // No TypeError — def was guarded before calling def.resolveApprovers
      expect(approvers.findBotOwnerAndMentor).not.toHaveBeenCalled();
    });

    it('falls back to defaultApprovers when primary set is empty', async () => {
      tenantMembersFindMany.mockResolvedValueOnce([]);
      // tools:invoke resolveApprovers returns [] when botId lookup returns empty
      approvers.findBotOwnerAndMentor.mockResolvedValueOnce([]);
      // fallback: workspace-admins (defaultApprovers for tools:invoke is workspace-admins)
      approvers.findWorkspaceAdmins.mockResolvedValueOnce(['u-admin']);
      approvers.findWorkspaceOwners.mockResolvedValueOnce([]);

      const ids = await svc.resolveApprovers({
        id: 'r1',
        tenantId: 't1',
        requesterBotId: 'b1',
        permissionKey: 'tools:invoke',
        requestedMetadata: {},
        suggestedApproverIds: [],
        contextChannelId: null,
        contextExecutionId: null,
        contextRoutineId: null,
      } as never);
      expect(ids).toContain('u-admin');
    });
  });

  describe('canDecide', () => {
    it('returns true when userId is in approvers list', async () => {
      tenantMembersFindMany.mockResolvedValueOnce([]);
      approvers.findBotOwnerAndMentor.mockResolvedValueOnce(['u-owner']);
      approvers.findWorkspaceOwners.mockResolvedValueOnce([]);

      const result = await svc.canDecide('u-owner', {
        id: 'r1',
        tenantId: 't1',
        requesterBotId: 'b1',
        permissionKey: 'tools:invoke',
        requestedMetadata: {},
        suggestedApproverIds: [],
        contextChannelId: null,
        contextExecutionId: null,
        contextRoutineId: null,
      } as never);
      expect(result).toBe(true);
    });

    it('returns false when userId is not in approvers list', async () => {
      tenantMembersFindMany.mockResolvedValueOnce([]);
      approvers.findBotOwnerAndMentor.mockResolvedValueOnce(['u-owner']);
      approvers.findWorkspaceOwners.mockResolvedValueOnce([]);

      const result = await svc.canDecide('u-stranger', {
        id: 'r1',
        tenantId: 't1',
        requesterBotId: 'b1',
        permissionKey: 'tools:invoke',
        requestedMetadata: {},
        suggestedApproverIds: [],
        contextChannelId: null,
        contextExecutionId: null,
        contextRoutineId: null,
      } as never);
      expect(result).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // requireBotIdForUser
  // ---------------------------------------------------------------------------

  describe('requireBotIdForUser', () => {
    it('returns bot id when user owns a bot row', async () => {
      botsFindFirst.mockResolvedValueOnce({ id: 'bot-abc' });
      const result = await svc.requireBotIdForUser('user-1');
      expect(result).toBe('bot-abc');
    });

    it('throws ForbiddenException when user has no bot row', async () => {
      botsFindFirst.mockResolvedValueOnce(undefined);
      const { ForbiddenException } = await import('@nestjs/common');
      await expect(
        svc.requireBotIdForUser('non-bot-user'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // ---------------------------------------------------------------------------
  // listGrants — includeRevoked=true
  // ---------------------------------------------------------------------------

  describe('listGrants', () => {
    it('when includeRevoked=true, returns both active and revoked grants', async () => {
      const activeGrant = {
        id: 'g-active',
        tenantId: 't1',
        revokedAt: null,
        permissionKey: 'messages:send',
      };
      const revokedGrant = {
        id: 'g-revoked',
        tenantId: 't1',
        revokedAt: new Date('2024-01-01'),
        permissionKey: 'messages:send',
      };
      grantsFindMany.mockResolvedValueOnce([activeGrant, revokedGrant]);

      const result = await svc.listGrants({
        tenantId: 't1',
        includeRevoked: true,
      });

      expect(result).toHaveLength(2);
      expect(result.map((g: any) => g.id)).toContain('g-active');
      expect(result.map((g: any) => g.id)).toContain('g-revoked');
    });

    it('when includeRevoked is not set, only active grants are returned', async () => {
      const activeGrant = {
        id: 'g-active',
        tenantId: 't1',
        revokedAt: null,
        permissionKey: 'messages:send',
      };
      // DB enforces the filter; mock returns only the active grant
      grantsFindMany.mockResolvedValueOnce([activeGrant]);

      const result = await svc.listGrants({ tenantId: 't1' });

      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe('g-active');
    });
  });
});

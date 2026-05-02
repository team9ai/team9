// apps/server/apps/gateway/src/permissions/__tests__/permissions.service.requests.spec.ts
import { jest } from '@jest/globals';
import { ConflictException, NotFoundException } from '@nestjs/common';

const insertGrantReturning = jest.fn();
const insertRequestReturning = jest.fn();
const updateRequestReturning = jest.fn();
const requestFindFirst = jest.fn();
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
    authPermissionRequests: { findFirst: requestFindFirst },
    tenantMembers: { findMany: tenantMembersFindMany },
  },
};

const mockDb = {
  ...tx,
  transaction: jest.fn(async (fn: any) => fn(tx)),
};

// eslint-disable-next-line @typescript-eslint/await-thenable
await jest.unstable_mockModule('@team9/database', () => ({
  DatabaseService: class {
    db = mockDb;
  },
  authPermissionGrants: { __name: 'grants' },
  authPermissionRequests: { __name: 'requests' },
  tenantMembers: {},
  // Provide DATABASE_CONNECTION token and Drizzle helpers used by transitive imports
  DATABASE_CONNECTION: 'DATABASE_CONNECTION',
  eq: jest.fn(),
  and: jest.fn(),
  isNull: jest.fn(),
  desc: jest.fn(),
  inArray: jest.fn(),
  // Table refs needed by PermissionsApproverRepository (transitive dep)
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
  });

  describe('cancelRequest', () => {
    it('cancels a pending request owned by the requester bot', async () => {
      updateRequestReturning.mockResolvedValueOnce([
        { id: 'r1', spellId: 'raven crystal flame', status: 'cancelled' },
      ]);

      const row = await svc.cancelRequest({
        requestId: 'r1',
        requesterBotId: 'b1',
      });
      expect(row.status).toBe('cancelled');
      expect(events.emit).toHaveBeenCalledWith(
        'permissions.request.decided',
        expect.objectContaining({ id: 'r1', status: 'cancelled' }),
      );
    });

    it('throws NotFoundException when no matching pending request', async () => {
      updateRequestReturning.mockResolvedValueOnce([]);
      await expect(
        svc.cancelRequest({ requestId: 'r1', requesterBotId: 'b1' }),
      ).rejects.toBeInstanceOf(NotFoundException);
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
          decision: 'once',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
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
});

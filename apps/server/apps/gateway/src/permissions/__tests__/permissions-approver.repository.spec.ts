// apps/server/apps/gateway/src/permissions/__tests__/permissions-approver.repository.spec.ts
import { jest } from '@jest/globals';

// The mock DB uses the actual Drizzle relational query key names, which match
// the exported const names from @team9/database (e.g. `channelMembers`, not
// the plan's speculative aliases like `imChannelMembers`).
const mockDb = {
  query: {
    channels: { findFirst: jest.fn() },
    channelMembers: { findMany: jest.fn() },
    bots: { findFirst: jest.fn() },
    routines: { findFirst: jest.fn() },
    workspaceWikis: { findFirst: jest.fn() },
    tenantMembers: { findMany: jest.fn(), findFirst: jest.fn() },
  },
};

// Mock @team9/database so the repository constructor gets our mockDb.
// DATABASE_CONNECTION is the injection token; the mock must export it.
// Note: jest.unstable_mockModule is typed as void but actually async at runtime;
// top-level await is used to ensure mock registration before dynamic import.
// eslint-disable-next-line @typescript-eslint/await-thenable
await jest.unstable_mockModule('@team9/database', () => ({
  DATABASE_CONNECTION: 'DATABASE_CONNECTION',
  eq: jest.fn(),
  and: jest.fn(),
  inArray: jest.fn(),
  isNull: jest.fn(),
  channels: {},
  channelMembers: {},
  bots: {},
  routines: {},
  workspaceWikis: {},
  tenantMembers: {},
  // Provide all table schemas exported from the repo (transitive)
  authPermissionGrants: {},
  authPermissionRequests: {},
}));

// Also mock @team9/database/schemas (imported as `* as schema` in the repo)
// eslint-disable-next-line @typescript-eslint/await-thenable
await jest.unstable_mockModule('@team9/database/schemas', () => ({}));

const { PermissionsApproverRepository } =
  await import('../permissions-approver.repository.js');

describe('PermissionsApproverRepository', () => {
  let repo: InstanceType<typeof PermissionsApproverRepository>;

  beforeEach(() => {
    jest.clearAllMocks();
    // Instantiate directly, bypassing NestJS DI, by passing mockDb as the db arg.
    repo = new PermissionsApproverRepository(mockDb as never);
  });

  describe('findChannelOwnersAndAdmins', () => {
    it('returns owner+admin user ids excluding left members', async () => {
      // First call: tenant guard succeeds — channel belongs to tenant
      (mockDb.query.channels.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'c1',
      });
      (mockDb.query.channelMembers.findMany as jest.Mock).mockResolvedValueOnce(
        [
          { userId: 'u-owner', role: 'owner', leftAt: null },
          { userId: 'u-admin', role: 'admin', leftAt: null },
        ],
      );
      const ids = await repo.findChannelOwnersAndAdmins('c1', 't1');
      expect(ids).toEqual(['u-owner', 'u-admin']);
      expect(mockDb.query.channelMembers.findMany).toHaveBeenCalledTimes(1);
    });

    it('returns empty array when channel has no owners or admins', async () => {
      (mockDb.query.channels.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'c-empty',
      });
      (mockDb.query.channelMembers.findMany as jest.Mock).mockResolvedValueOnce(
        [],
      );
      const ids = await repo.findChannelOwnersAndAdmins('c-empty', 't1');
      expect(ids).toEqual([]);
    });

    it('returns empty array when channel belongs to a different tenant', async () => {
      // Tenant guard fails — channel not found for that tenantId
      (mockDb.query.channels.findFirst as jest.Mock).mockResolvedValueOnce(
        null,
      );
      const ids = await repo.findChannelOwnersAndAdmins('c1', 'other-tenant');
      expect(ids).toEqual([]);
      // Should NOT query channelMembers when tenant guard fails
      expect(mockDb.query.channelMembers.findMany).not.toHaveBeenCalled();
    });
  });

  describe('findBotOwnerAndMentor', () => {
    it('filters nulls — returns only non-null ids verified in tenant', async () => {
      (mockDb.query.bots.findFirst as jest.Mock).mockResolvedValueOnce({
        ownerId: 'u-owner',
        mentorId: null,
      });
      // Tenant verification: u-owner is a member of t1
      (mockDb.query.tenantMembers.findMany as jest.Mock).mockResolvedValueOnce([
        { userId: 'u-owner' },
      ]);
      const ids = await repo.findBotOwnerAndMentor('b1', 't1');
      expect(ids).toEqual(['u-owner']);
    });

    it('returns both owner and mentor when both are set and in tenant', async () => {
      (mockDb.query.bots.findFirst as jest.Mock).mockResolvedValueOnce({
        ownerId: 'u-owner',
        mentorId: 'u-mentor',
      });
      (mockDb.query.tenantMembers.findMany as jest.Mock).mockResolvedValueOnce([
        { userId: 'u-owner' },
        { userId: 'u-mentor' },
      ]);
      const ids = await repo.findBotOwnerAndMentor('b2', 't1');
      expect(ids).toEqual(['u-owner', 'u-mentor']);
    });

    it('returns empty when bot not found', async () => {
      (mockDb.query.bots.findFirst as jest.Mock).mockResolvedValueOnce(null);
      const ids = await repo.findBotOwnerAndMentor('b-missing', 't1');
      expect(ids).toEqual([]);
    });

    it('returns empty when both ownerId and mentorId are null', async () => {
      (mockDb.query.bots.findFirst as jest.Mock).mockResolvedValueOnce({
        ownerId: null,
        mentorId: null,
      });
      const ids = await repo.findBotOwnerAndMentor('b-no-owner', 't1');
      expect(ids).toEqual([]);
    });

    it('filters out owner/mentor that are not members of the requested tenant', async () => {
      // Bot's ownerId belongs to a different tenant
      (mockDb.query.bots.findFirst as jest.Mock).mockResolvedValueOnce({
        ownerId: 'u-foreign',
        mentorId: null,
      });
      // Tenant verification returns empty — u-foreign is not in t1
      (mockDb.query.tenantMembers.findMany as jest.Mock).mockResolvedValueOnce(
        [],
      );
      const ids = await repo.findBotOwnerAndMentor('b1', 't1');
      expect(ids).toEqual([]);
    });
  });

  describe('findRoutineCreatorAndOwner', () => {
    it('returns creatorId (routines table has no ownerId column)', async () => {
      (mockDb.query.routines.findFirst as jest.Mock).mockResolvedValueOnce({
        creatorId: 'u-creator',
      });
      const ids = await repo.findRoutineCreatorAndOwner('r1', 't1');
      expect(ids).toEqual(['u-creator']);
    });

    it('returns empty when routine not found', async () => {
      (mockDb.query.routines.findFirst as jest.Mock).mockResolvedValueOnce(
        null,
      );
      const ids = await repo.findRoutineCreatorAndOwner('r-missing', 't1');
      expect(ids).toEqual([]);
    });

    it('returns empty when routine belongs to a different tenant', async () => {
      // tenantId filter causes findFirst to return null for a different tenant
      (mockDb.query.routines.findFirst as jest.Mock).mockResolvedValueOnce(
        null,
      );
      const ids = await repo.findRoutineCreatorAndOwner('r1', 'other-tenant');
      expect(ids).toEqual([]);
    });
  });

  describe('findWikiOwners', () => {
    it('returns createdBy as wiki owner (workspaceWikis uses createdBy not ownerId)', async () => {
      (
        mockDb.query.workspaceWikis.findFirst as jest.Mock
      ).mockResolvedValueOnce({ createdBy: 'u-wiki-creator' });
      const ids = await repo.findWikiOwners('w1', 't1');
      expect(ids).toEqual(['u-wiki-creator']);
    });

    it('returns empty when wiki not found', async () => {
      (
        mockDb.query.workspaceWikis.findFirst as jest.Mock
      ).mockResolvedValueOnce(null);
      const ids = await repo.findWikiOwners('w-missing', 't1');
      expect(ids).toEqual([]);
    });

    it('returns empty when createdBy is empty string', async () => {
      (
        mockDb.query.workspaceWikis.findFirst as jest.Mock
      ).mockResolvedValueOnce({ createdBy: '' });
      const ids = await repo.findWikiOwners('w-empty', 't1');
      expect(ids).toEqual([]);
    });

    it('returns empty when wiki belongs to a different tenant (workspaceId mismatch)', async () => {
      // workspaceId filter causes findFirst to return null for a different tenant
      (
        mockDb.query.workspaceWikis.findFirst as jest.Mock
      ).mockResolvedValueOnce(null);
      const ids = await repo.findWikiOwners('w1', 'other-tenant');
      expect(ids).toEqual([]);
    });
  });

  describe('findWorkspaceOwners', () => {
    it('returns user ids for owner-role members', async () => {
      (mockDb.query.tenantMembers.findMany as jest.Mock).mockResolvedValueOnce([
        { userId: 'u-ws-owner' },
      ]);
      const ids = await repo.findWorkspaceOwners('t1');
      expect(ids).toEqual(['u-ws-owner']);
    });

    it('returns empty when no owners found', async () => {
      (mockDb.query.tenantMembers.findMany as jest.Mock).mockResolvedValueOnce(
        [],
      );
      const ids = await repo.findWorkspaceOwners('t-empty');
      expect(ids).toEqual([]);
    });
  });

  describe('findWorkspaceAdmins', () => {
    it('returns user ids for owner and admin role members', async () => {
      (mockDb.query.tenantMembers.findMany as jest.Mock).mockResolvedValueOnce([
        { userId: 'u-ws-owner' },
        { userId: 'u-ws-admin' },
      ]);
      const ids = await repo.findWorkspaceAdmins('t1');
      expect(ids).toEqual(['u-ws-owner', 'u-ws-admin']);
    });

    it('returns empty when no admins found', async () => {
      (mockDb.query.tenantMembers.findMany as jest.Mock).mockResolvedValueOnce(
        [],
      );
      const ids = await repo.findWorkspaceAdmins('t-empty');
      expect(ids).toEqual([]);
    });
  });
});

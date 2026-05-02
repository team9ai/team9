// apps/server/apps/gateway/src/permissions/__tests__/permissions-approver.repository.spec.ts
import { jest } from '@jest/globals';

// The mock DB uses the actual Drizzle relational query key names, which match
// the exported const names from @team9/database (e.g. `channelMembers`, not
// the plan's speculative aliases like `imChannelMembers`).
const mockDb = {
  query: {
    channelMembers: { findMany: jest.fn() },
    bots: { findFirst: jest.fn() },
    routines: { findFirst: jest.fn() },
    workspaceWikis: { findFirst: jest.fn() },
    tenantMembers: { findMany: jest.fn() },
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
  channelMembers: {},
  bots: {},
  routines: {},
  workspaceWikis: {},
  tenantMembers: {},
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
      (mockDb.query.channelMembers.findMany as jest.Mock).mockResolvedValueOnce(
        [
          { userId: 'u-owner', role: 'owner', leftAt: null },
          { userId: 'u-admin', role: 'admin', leftAt: null },
        ],
      );
      const ids = await repo.findChannelOwnersAndAdmins('c1');
      expect(ids).toEqual(['u-owner', 'u-admin']);
      expect(mockDb.query.channelMembers.findMany).toHaveBeenCalledTimes(1);
    });

    it('returns empty array when channel has no owners or admins', async () => {
      (mockDb.query.channelMembers.findMany as jest.Mock).mockResolvedValueOnce(
        [],
      );
      const ids = await repo.findChannelOwnersAndAdmins('c-empty');
      expect(ids).toEqual([]);
    });
  });

  describe('findBotOwnerAndMentor', () => {
    it('filters nulls — returns only non-null ids', async () => {
      (mockDb.query.bots.findFirst as jest.Mock).mockResolvedValueOnce({
        ownerId: 'u-owner',
        mentorId: null,
      });
      const ids = await repo.findBotOwnerAndMentor('b1');
      expect(ids).toEqual(['u-owner']);
    });

    it('returns both owner and mentor when both are set', async () => {
      (mockDb.query.bots.findFirst as jest.Mock).mockResolvedValueOnce({
        ownerId: 'u-owner',
        mentorId: 'u-mentor',
      });
      const ids = await repo.findBotOwnerAndMentor('b2');
      expect(ids).toEqual(['u-owner', 'u-mentor']);
    });

    it('returns empty when bot not found', async () => {
      (mockDb.query.bots.findFirst as jest.Mock).mockResolvedValueOnce(null);
      const ids = await repo.findBotOwnerAndMentor('b-missing');
      expect(ids).toEqual([]);
    });

    it('returns empty when both ownerId and mentorId are null', async () => {
      (mockDb.query.bots.findFirst as jest.Mock).mockResolvedValueOnce({
        ownerId: null,
        mentorId: null,
      });
      const ids = await repo.findBotOwnerAndMentor('b-no-owner');
      expect(ids).toEqual([]);
    });
  });

  describe('findRoutineCreatorAndOwner', () => {
    it('returns creatorId (routines table has no ownerId column)', async () => {
      (mockDb.query.routines.findFirst as jest.Mock).mockResolvedValueOnce({
        creatorId: 'u-creator',
      });
      const ids = await repo.findRoutineCreatorAndOwner('r1');
      expect(ids).toEqual(['u-creator']);
    });

    it('returns empty when routine not found', async () => {
      (mockDb.query.routines.findFirst as jest.Mock).mockResolvedValueOnce(
        null,
      );
      const ids = await repo.findRoutineCreatorAndOwner('r-missing');
      expect(ids).toEqual([]);
    });
  });

  describe('findWikiOwners', () => {
    it('returns createdBy as wiki owner (workspaceWikis uses createdBy not ownerId)', async () => {
      (
        mockDb.query.workspaceWikis.findFirst as jest.Mock
      ).mockResolvedValueOnce({ createdBy: 'u-wiki-creator' });
      const ids = await repo.findWikiOwners('w1');
      expect(ids).toEqual(['u-wiki-creator']);
    });

    it('returns empty when wiki not found', async () => {
      (
        mockDb.query.workspaceWikis.findFirst as jest.Mock
      ).mockResolvedValueOnce(null);
      const ids = await repo.findWikiOwners('w-missing');
      expect(ids).toEqual([]);
    });

    it('returns empty when createdBy is empty string', async () => {
      (
        mockDb.query.workspaceWikis.findFirst as jest.Mock
      ).mockResolvedValueOnce({ createdBy: '' });
      const ids = await repo.findWikiOwners('w-empty');
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

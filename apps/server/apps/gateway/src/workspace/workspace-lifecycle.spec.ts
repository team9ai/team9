import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';

// ── helpers ──────────────────────────────────────────────────────────────────

type MockFn = jest.Mock<(...args: any[]) => any>;

/**
 * Create a thenable, chainable DB mock.
 * All methods return the same chain object. The chain is thenable:
 * `await chain.select().from().where().limit(1)` consumes the next
 * enqueued value from the return queue.
 */
function createDbMock() {
  const returnQueue: any[][] = [];
  const chain: Record<string, any> = {};

  const methods = [
    'select',
    'selectDistinct',
    'from',
    'where',
    'limit',
    'insert',
    'values',
    'returning',
    'update',
    'set',
    'delete',
    'innerJoin',
    'leftJoin',
    'orderBy',
  ];
  for (const m of methods) {
    chain[m] = jest.fn<any>().mockReturnValue(chain);
  }

  // Make the chain thenable for `await`
  chain.then = (resolve: (v: any) => void, reject?: (e: any) => void) => {
    const value = returnQueue.length > 0 ? returnQueue.shift()! : [];
    return Promise.resolve(value).then(resolve, reject);
  };

  function enqueue(value: any[]) {
    returnQueue.push(value);
  }

  return { db: chain, enqueue };
}

// ── fixtures ─────────────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-uuid';
const USER_ID = 'user-uuid';
const INVITATION_CODE = 'invite-code-abc';
const PERSONAL_STAFF_APP = {
  id: 'installed-ps-uuid',
  applicationId: 'personal-staff',
  tenantId: TENANT_ID,
};

// ── dynamic imports (ESM compat) ─────────────────────────────────────────────

// We import WorkspaceService dynamically to work with ESM + jest mocking.
// Since we construct the service manually, we don't need NestJS TestingModule.

let WorkspaceService: any;

beforeEach(async () => {
  const mod = await import('./workspace.service.js');
  WorkspaceService = mod.WorkspaceService;
});

// ── tests ────────────────────────────────────────────────────────────────────

describe('WorkspaceService — member lifecycle hooks', () => {
  let service: any;
  let db: ReturnType<typeof createDbMock>['db'];
  let enqueue: ReturnType<typeof createDbMock>['enqueue'];
  let installedApplicationsService: {
    findByApplicationId: MockFn;
    install: MockFn;
    findAllByTenant: MockFn;
  };
  let personalStaffService: {
    createStaff: MockFn;
    deleteStaff: MockFn;
  };
  let websocketGateway: {
    broadcastToWorkspace: MockFn;
    sendToChannelMembers: MockFn;
    sendToUser: MockFn;
  };
  let channelsService: Record<string, MockFn>;
  let redisService: { hgetall: MockFn };

  beforeEach(() => {
    const mock = createDbMock();
    db = mock.db;
    enqueue = mock.enqueue;

    installedApplicationsService = {
      findByApplicationId: jest.fn<any>().mockResolvedValue(null),
      install: jest.fn<any>().mockResolvedValue({ id: 'installed-id' }),
      findAllByTenant: jest.fn<any>().mockResolvedValue([]),
    };

    personalStaffService = {
      createStaff: jest.fn<any>().mockResolvedValue({
        botId: 'bot-id',
        userId: 'bot-user-id',
        agentId: 'agent-id',
        displayName: 'Personal Assistant',
      }),
      deleteStaff: jest.fn<any>().mockResolvedValue(undefined),
    };

    websocketGateway = {
      broadcastToWorkspace: jest.fn<any>().mockResolvedValue(undefined),
      sendToChannelMembers: jest.fn<any>().mockResolvedValue(true),
      sendToUser: jest.fn<any>().mockResolvedValue(undefined),
    };

    channelsService = {
      createDirectChannelsBatch: jest.fn<any>().mockResolvedValue(new Map()),
      createDirectChannel: jest.fn<any>().mockResolvedValue(undefined),
      create: jest.fn<any>().mockResolvedValue({ id: 'channel-id' }),
      findByNameAndTenant: jest.fn<any>().mockResolvedValue(null),
      addMember: jest.fn<any>().mockResolvedValue(undefined),
      sendSystemMessage: jest.fn<any>().mockResolvedValue({
        id: 'msg-id',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    };

    redisService = {
      hgetall: jest.fn<any>().mockResolvedValue({}),
    };

    // Construct service directly to avoid DI resolving the thenable chain
    service = new WorkspaceService(
      db, // DATABASE_CONNECTION
      websocketGateway, // WEBSOCKET_GATEWAY
      redisService, // RedisService
      channelsService, // ChannelsService
      { getBotUserId: jest.fn<any>().mockReturnValue(null) }, // BotService
      installedApplicationsService, // InstalledApplicationsService
      { findAutoInstall: jest.fn<any>().mockReturnValue([]) }, // ApplicationsService
      personalStaffService, // PersonalStaffService
      {} as any, // OnboardingService (not used in lifecycle tests)
      { capture: jest.fn<any>() }, // PosthogService
      { grantCredits: jest.fn<any>().mockResolvedValue(undefined) }, // BillingHubService
      { createWiki: jest.fn<any>().mockResolvedValue(undefined) }, // WikisService
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // acceptInvitation — personal staff auto-creation
  // ═══════════════════════════════════════════════════════════════════════════

  describe('acceptInvitation — personal staff auto-creation', () => {
    /**
     * Enqueue all DB responses for a successful acceptInvitation call.
     *
     * Sequential awaited DB calls:
     * 1. select().from().where().limit(1) — get invitation
     * 2. select().from().where().limit(1) — check existing membership
     * 3. select({count}).from().where() — getWorkspaceMemberCount
     * 4. insert().values().returning() — add member
     * 5. insert().values() — record invitation usage
     * 6. update().set().where() — update invitation usedCount
     * 7. select().from().where().limit(1) — get workspace info
     * 8. select().from().where().limit(1) — get user info
     * 9. select().from().where() — getOnlineOfflineMemberIds
     * 10. select().from().innerJoin().where() — existing members for DMs
     */
    function setupAcceptInvitationMocks() {
      // 1. Get invitation
      enqueue([
        {
          id: 'invitation-uuid',
          tenantId: TENANT_ID,
          code: INVITATION_CODE,
          isActive: true,
          expiresAt: null,
          maxUses: null,
          usedCount: 0,
          role: 'member',
          createdBy: 'owner-uuid',
        },
      ]);
      // 2. Check existing membership — not a member
      enqueue([]);
      // 3. getWorkspaceMemberCount
      enqueue([{ count: 5 }]);
      // 4. Insert member
      enqueue([
        {
          id: 'member-uuid',
          tenantId: TENANT_ID,
          userId: USER_ID,
          role: 'member',
          joinedAt: new Date(),
        },
      ]);
      // 5. Record invitation usage
      enqueue([]);
      // 6. Update invitation usedCount
      enqueue([]);
      // 7. Get workspace info
      enqueue([
        {
          id: TENANT_ID,
          name: 'Test Workspace',
          slug: 'test-workspace',
        },
      ]);
      // 8. Get user info
      enqueue([
        {
          id: USER_ID,
          username: 'testuser',
          displayName: 'Test User',
          avatarUrl: null,
          status: 'online',
          userType: 'human',
        },
      ]);
      // 9. getOnlineOfflineMemberIds — workspace members
      enqueue([]);
      // 10. Existing members for DM channels
      enqueue([]);
    }

    it('creates personal staff when personal-staff app is installed', async () => {
      setupAcceptInvitationMocks();
      installedApplicationsService.findByApplicationId.mockResolvedValue(
        PERSONAL_STAFF_APP,
      );

      await service.acceptInvitation(INVITATION_CODE, USER_ID);

      expect(
        installedApplicationsService.findByApplicationId,
      ).toHaveBeenCalledWith(TENANT_ID, 'personal-staff');
      expect(personalStaffService.createStaff).toHaveBeenCalledWith(
        PERSONAL_STAFF_APP.id,
        TENANT_ID,
        USER_ID,
        {
          model: { provider: 'openrouter', id: 'anthropic/claude-sonnet-4.6' },
          agenticBootstrap: true,
        },
      );
    });

    it('does NOT create personal staff when app is not installed', async () => {
      setupAcceptInvitationMocks();
      installedApplicationsService.findByApplicationId.mockResolvedValue(null);

      await service.acceptInvitation(INVITATION_CODE, USER_ID);

      expect(personalStaffService.createStaff).not.toHaveBeenCalled();
    });

    it('does NOT fail invitation if personal staff creation throws', async () => {
      setupAcceptInvitationMocks();
      installedApplicationsService.findByApplicationId.mockResolvedValue(
        PERSONAL_STAFF_APP,
      );
      personalStaffService.createStaff.mockRejectedValueOnce(
        new Error('Claw Hive unreachable'),
      );

      const result = await service.acceptInvitation(INVITATION_CODE, USER_ID);

      expect(result.workspace.id).toBe(TENANT_ID);
      expect(result.member.role).toBe('member');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // removeMember — personal staff cleanup
  // ═══════════════════════════════════════════════════════════════════════════

  describe('removeMember — personal staff cleanup', () => {
    it('deletes personal staff when personal-staff app is installed', async () => {
      installedApplicationsService.findByApplicationId.mockResolvedValue(
        PERSONAL_STAFF_APP,
      );

      await service.removeMember(TENANT_ID, USER_ID);

      expect(
        installedApplicationsService.findByApplicationId,
      ).toHaveBeenCalledWith(TENANT_ID, 'personal-staff');
      expect(personalStaffService.deleteStaff).toHaveBeenCalledWith(
        PERSONAL_STAFF_APP.id,
        TENANT_ID,
        USER_ID,
      );
    });

    it('does NOT call deleteStaff when app is not installed', async () => {
      installedApplicationsService.findByApplicationId.mockResolvedValue(null);

      await service.removeMember(TENANT_ID, USER_ID);

      expect(personalStaffService.deleteStaff).not.toHaveBeenCalled();
    });

    it('silently ignores NotFoundException (member has no personal staff)', async () => {
      installedApplicationsService.findByApplicationId.mockResolvedValue(
        PERSONAL_STAFF_APP,
      );
      personalStaffService.deleteStaff.mockRejectedValueOnce(
        new NotFoundException('Personal staff not found for current user'),
      );

      await service.removeMember(TENANT_ID, USER_ID);

      expect(db.update).toHaveBeenCalled();
    });

    it('logs warning on non-NotFoundException errors but still removes member', async () => {
      installedApplicationsService.findByApplicationId.mockResolvedValue(
        PERSONAL_STAFF_APP,
      );
      personalStaffService.deleteStaff.mockRejectedValueOnce(
        new Error('Database connection lost'),
      );

      await service.removeMember(TENANT_ID, USER_ID);

      expect(db.update).toHaveBeenCalled();
    });

    it('still marks member as left even when findByApplicationId fails', async () => {
      installedApplicationsService.findByApplicationId.mockRejectedValueOnce(
        new Error('Unexpected error'),
      );

      await service.removeMember(TENANT_ID, USER_ID);

      expect(db.update).toHaveBeenCalled();
      expect(db.set).toHaveBeenCalledWith(
        expect.objectContaining({ leftAt: expect.any(Date) }),
      );
    });
  });
});

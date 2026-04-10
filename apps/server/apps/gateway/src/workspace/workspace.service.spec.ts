import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { WorkspaceService } from './workspace.service.js';
import { BotService } from '../bot/bot.service.js';
import { ChannelsService } from '../im/channels/channels.service.js';
import { InstalledApplicationsService } from '../applications/installed-applications.service.js';
import { ApplicationsService } from '../applications/applications.service.js';
import { PersonalStaffService } from '../applications/personal-staff.service.js';
import { OnboardingService } from './onboarding.service.js';
import { RedisService } from '@team9/redis';
import { DATABASE_CONNECTION } from '@team9/database';
import { WEBSOCKET_GATEWAY } from '../shared/constants/injection-tokens.js';
import { PosthogService } from '@team9/posthog';

// ── helpers ──────────────────────────────────────────────────────────

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
    'delete',
    'innerJoin',
    'leftJoin',
    'orderBy',
    'offset',
  ];
  for (const m of methods) {
    chain[m] = jest.fn<any>().mockReturnValue(chain);
  }
  chain.limit.mockResolvedValue([]);
  chain.returning.mockResolvedValue([]);
  return chain;
}

const WORKSPACE_ROW = {
  id: 'ws-uuid',
  name: 'Test Workspace',
  slug: 'test-workspace',
  domain: null,
  logoUrl: null,
  plan: 'free',
  settings: {},
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('WorkspaceService', () => {
  let service: WorkspaceService;
  let db: ReturnType<typeof mockDb>;
  let botService: {
    getBotUserId: MockFn;
  };
  let applicationsService: {
    findAutoInstall: MockFn;
  };
  let installedApplicationsService: {
    install: MockFn;
    getInstalledApplicationsForTenant: MockFn;
  };
  let redisService: {
    hgetall: MockFn;
  };
  let channelsService: {
    create: MockFn;
    createDirectChannel: MockFn;
    createDirectChannelsBatch: MockFn;
    findByNameAndTenant: MockFn;
    addMember: MockFn;
    sendSystemMessage: MockFn;
  };
  let websocketGateway: {
    broadcastToWorkspace: MockFn;
    sendToUser: MockFn;
    sendToChannelMembers: MockFn;
  };
  let onboardingService: {
    createStarterRecord: MockFn;
    createSkippedRecord: MockFn;
  };
  beforeEach(async () => {
    db = mockDb();
    botService = {
      getBotUserId: jest.fn<any>().mockReturnValue(null),
    };
    applicationsService = {
      findAutoInstall: jest
        .fn<any>()
        .mockReturnValue([
          { id: 'base-model-staff', name: 'Base Model Staff' },
        ]),
    };
    installedApplicationsService = {
      install: jest.fn<any>().mockResolvedValue(undefined),
      getInstalledApplicationsForTenant: jest.fn<any>().mockResolvedValue([]),
    };
    redisService = {
      hgetall: jest.fn<any>().mockResolvedValue({}),
    };
    channelsService = {
      create: jest.fn<any>().mockResolvedValue({}),
      createDirectChannel: jest.fn<any>().mockResolvedValue({}),
      createDirectChannelsBatch: jest.fn<any>().mockResolvedValue(new Map()),
      findByNameAndTenant: jest.fn<any>().mockResolvedValue(null),
      addMember: jest.fn<any>().mockResolvedValue(undefined),
      sendSystemMessage: jest.fn<any>().mockResolvedValue({
        id: 'sys-msg-uuid',
        channelId: 'welcome-channel-uuid',
        senderId: null,
        content: 'Alice joined Test Workspace',
        type: 'system',
        isPinned: false,
        isEdited: false,
        isDeleted: false,
        createdAt: new Date('2026-01-15T10:00:00Z'),
        updatedAt: new Date('2026-01-15T10:00:00Z'),
      }),
    };
    websocketGateway = {
      broadcastToWorkspace: jest.fn<any>(),
      sendToUser: jest.fn<any>(),
      sendToChannelMembers: jest.fn<any>().mockResolvedValue(true),
    };
    onboardingService = {
      createStarterRecord: jest.fn<any>().mockResolvedValue(undefined),
      createSkippedRecord: jest.fn<any>().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspaceService,
        { provide: DATABASE_CONNECTION, useValue: db },
        { provide: WEBSOCKET_GATEWAY, useValue: websocketGateway },
        { provide: RedisService, useValue: redisService },
        { provide: ChannelsService, useValue: channelsService },
        { provide: BotService, useValue: botService },
        {
          provide: InstalledApplicationsService,
          useValue: installedApplicationsService,
        },
        {
          provide: ApplicationsService,
          useValue: applicationsService,
        },
        {
          provide: PersonalStaffService,
          useValue: {
            createStaff: jest.fn<any>().mockResolvedValue(undefined),
            deleteStaff: jest.fn<any>().mockResolvedValue(undefined),
          },
        },
        { provide: OnboardingService, useValue: onboardingService },
        {
          provide: PosthogService,
          useValue: {
            capture: jest.fn(),
            isEnabled: jest.fn().mockReturnValue(false),
          },
        },
      ],
    }).compile();

    service = module.get<WorkspaceService>(WorkspaceService);

    // Stub internal helpers that hit the DB
    jest.spyOn(service, 'findBySlug' as any).mockResolvedValue(null);
    jest.spyOn(service, 'findByDomain' as any).mockResolvedValue(null);
    jest
      .spyOn(service, 'generateUniqueSlug' as any)
      .mockResolvedValue('test-workspace');
    jest.spyOn(service, 'addMember' as any).mockResolvedValue(undefined);
    jest
      .spyOn(service, 'getUserOwnedWorkspaceCount' as any)
      .mockResolvedValue(0);
    jest.spyOn(service, 'getWorkspaceMemberCount' as any).mockResolvedValue(0);
  });

  // ── create: custom bot ────────────────────────────────────────────

  describe('create', () => {
    beforeEach(() => {
      db.returning.mockResolvedValue([WORKSPACE_ROW] as any);
    });

    it('should auto-install applications for the workspace', async () => {
      await service.create({ name: 'Test Workspace', ownerId: 'owner-1' });

      expect(applicationsService.findAutoInstall).toHaveBeenCalled();
      expect(installedApplicationsService.install).toHaveBeenCalledWith(
        'ws-uuid',
        'owner-1',
        { applicationId: 'base-model-staff' },
      );
    });

    it('should auto-install even when system bot is disabled', async () => {
      botService.getBotUserId.mockReturnValue(null);

      await service.create({ name: 'Test Workspace', ownerId: 'owner-1' });

      expect(installedApplicationsService.install).toHaveBeenCalledTimes(1);
    });

    it('should auto-install multiple apps when configured', async () => {
      applicationsService.findAutoInstall.mockReturnValue([
        { id: 'app-a', name: 'App A' },
        { id: 'app-b', name: 'App B' },
      ]);

      await service.create({ name: 'Test Workspace', ownerId: 'owner-1' });

      expect(installedApplicationsService.install).toHaveBeenCalledTimes(2);
      expect(installedApplicationsService.install).toHaveBeenCalledWith(
        'ws-uuid',
        'owner-1',
        { applicationId: 'app-a' },
      );
      expect(installedApplicationsService.install).toHaveBeenCalledWith(
        'ws-uuid',
        'owner-1',
        { applicationId: 'app-b' },
      );
    });

    it('should skip auto-install when no apps are configured', async () => {
      applicationsService.findAutoInstall.mockReturnValue([]);

      await service.create({ name: 'Test Workspace', ownerId: 'owner-1' });

      expect(installedApplicationsService.install).not.toHaveBeenCalled();
    });

    it('should roll back the workspace when critical starter setup fails', async () => {
      channelsService.create.mockRejectedValueOnce(new Error('channel failed'));

      await expect(
        service.create({ name: 'Test Workspace', ownerId: 'owner-1' }),
      ).rejects.toThrow('channel failed');

      expect(db.delete).toHaveBeenCalled();
    });

    it('should add system bot alongside auto-install when system bot is enabled', async () => {
      botService.getBotUserId.mockReturnValue('system-bot-user');

      await service.create({ name: 'Test Workspace', ownerId: 'owner-1' });

      // System bot added as member
      expect(service.addMember).toHaveBeenCalledWith(
        'ws-uuid',
        'system-bot-user',
        'member',
        'owner-1',
      );

      // System bot DM channel created
      expect(channelsService.createDirectChannel).toHaveBeenCalledWith(
        'owner-1',
        'system-bot-user',
        'ws-uuid',
      );

      // Auto-install apps also installed
      expect(installedApplicationsService.install).toHaveBeenCalledWith(
        'ws-uuid',
        'owner-1',
        { applicationId: 'base-model-staff' },
      );
    });

    it('should not fail workspace creation if auto-install fails', async () => {
      installedApplicationsService.install.mockRejectedValue(
        new Error('Install failed'),
      );

      const result = await service.create({
        name: 'Test Workspace',
        ownerId: 'owner-1',
      });

      expect(result).toEqual(WORKSPACE_ROW);
      expect(installedApplicationsService.install).toHaveBeenCalled();
    });

    it('should not fail workspace creation if system bot addition fails', async () => {
      botService.getBotUserId.mockReturnValue('system-bot-user');
      // First call (owner) succeeds, second call (system bot) fails
      (service.addMember as MockFn)
        .mockResolvedValueOnce(undefined as any)
        .mockRejectedValueOnce(new Error('System bot add failed'));

      const result = await service.create({
        name: 'Test Workspace',
        ownerId: 'owner-1',
      });

      expect(result).toEqual(WORKSPACE_ROW);
      // Auto-install apps should still be installed even if system bot fails
      expect(installedApplicationsService.install).toHaveBeenCalled();
    });

    it('should create welcome channel before app auto-install', async () => {
      const callOrder: string[] = [];
      channelsService.create.mockImplementation((() => {
        callOrder.push('welcome-channel');
        return Promise.resolve({});
      }) as any);
      installedApplicationsService.install.mockImplementation((() => {
        callOrder.push('auto-install');
        return Promise.resolve(undefined);
      }) as any);

      await service.create({ name: 'Test Workspace', ownerId: 'owner-1' });

      expect(callOrder).toEqual(['welcome-channel', 'auto-install']);
    });

    it('should add owner as member with owner role', async () => {
      await service.create({ name: 'Test Workspace', ownerId: 'owner-1' });

      expect(service.addMember).toHaveBeenCalledWith(
        'ws-uuid',
        'owner-1',
        'owner',
      );
    });

    it('should throw when user has reached max workspace limit (3)', async () => {
      (service as any).getUserOwnedWorkspaceCount.mockResolvedValue(3);

      await expect(
        service.create({ name: 'New Workspace', ownerId: 'owner-1' }),
      ).rejects.toThrow('You can create a maximum of 3 workspaces');
    });

    it('should allow creation when user is below workspace limit', async () => {
      (service as any).getUserOwnedWorkspaceCount.mockResolvedValue(2);

      const result = await service.create({
        name: 'Test Workspace',
        ownerId: 'owner-1',
      });

      expect(result).toEqual(WORKSPACE_ROW);
    });

    it('should throw when a provided slug already exists', async () => {
      (service as any).findBySlug.mockResolvedValueOnce({
        id: 'existing-workspace',
      });

      await expect(
        service.create({
          name: 'Test Workspace',
          slug: 'custom-slug',
          ownerId: 'owner-1',
        }),
      ).rejects.toThrow('Workspace slug already exists');
    });

    it('should throw when a provided domain is already in use', async () => {
      (service as any).findByDomain.mockResolvedValueOnce({
        id: 'existing-workspace',
      });

      await expect(
        service.create({
          name: 'Test Workspace',
          domain: 'team9.test',
          ownerId: 'owner-1',
        }),
      ).rejects.toThrow('Domain already in use');
    });
  });

  // ── invitations ─────────────────────────────────────────────────

  describe('createInvitation', () => {
    beforeEach(() => {
      process.env.APP_URL = 'https://app.team9.test';
      jest
        .spyOn(service as any, 'generateInviteCode')
        .mockReturnValue('invite-code');
    });

    it('should shape the invitation response with URL, creator info, and defaults', async () => {
      const nowSpy = jest
        .spyOn(Date, 'now')
        .mockReturnValue(new Date('2026-04-02T12:00:00.000Z').getTime());
      db.returning.mockResolvedValueOnce([
        {
          id: 'invitation-uuid',
          code: 'invite-code',
          role: 'member',
          maxUses: 5,
          usedCount: 0,
          expiresAt: new Date('2026-04-04T12:00:00.000Z'),
          isActive: true,
          createdAt: new Date('2026-04-02T12:00:00.000Z'),
        },
      ] as any);
      db.limit.mockResolvedValueOnce([
        {
          id: 'creator-uuid',
          username: 'alice',
          displayName: 'Alice',
        },
      ] as any);

      const result = await service.createInvitation('ws-uuid', 'creator-uuid', {
        maxUses: 5,
        expiresInDays: 2,
      } as any);

      expect(result).toEqual({
        id: 'invitation-uuid',
        code: 'invite-code',
        url: 'https://app.team9.test/invite/invite-code',
        role: 'member',
        maxUses: 5,
        usedCount: 0,
        expiresAt: new Date('2026-04-04T12:00:00.000Z'),
        isActive: true,
        createdAt: new Date('2026-04-02T12:00:00.000Z'),
        createdBy: {
          id: 'creator-uuid',
          username: 'alice',
          displayName: 'Alice',
        },
      });

      nowSpy.mockRestore();
    });
  });

  describe('getInvitationInfo', () => {
    it('should return not found when the invitation does not exist', async () => {
      db.limit.mockResolvedValueOnce([]);

      await expect(service.getInvitationInfo('missing-code')).resolves.toEqual({
        workspaceName: '',
        workspaceSlug: '',
        isValid: false,
        reason: 'Invitation not found',
      });
    });

    it('should return revoked info when the invitation is inactive', async () => {
      db.limit.mockResolvedValueOnce([
        {
          invitation: {
            id: 'invitation-uuid',
            tenantId: 'ws-uuid',
            code: 'invite-code',
            createdBy: 'creator-uuid',
            role: 'member',
            maxUses: null,
            usedCount: 0,
            expiresAt: null,
            isActive: false,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          workspace: {
            name: 'Test Workspace',
            slug: 'test-workspace',
          },
          creator: {
            username: 'alice',
            displayName: 'Alice',
          },
        },
      ] as any);

      await expect(service.getInvitationInfo('invite-code')).resolves.toEqual({
        workspaceName: 'Test Workspace',
        workspaceSlug: 'test-workspace',
        isValid: false,
        reason: 'Invitation has been revoked',
      });
    });

    it('should return expired info when the invitation is past its expiry', async () => {
      db.limit.mockResolvedValueOnce([
        {
          invitation: {
            id: 'invitation-uuid',
            tenantId: 'ws-uuid',
            code: 'invite-code',
            createdBy: 'creator-uuid',
            role: 'member',
            maxUses: null,
            usedCount: 0,
            expiresAt: new Date('2026-01-01T00:00:00.000Z'),
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          workspace: {
            name: 'Test Workspace',
            slug: 'test-workspace',
          },
          creator: {
            username: 'alice',
            displayName: 'Alice',
          },
        },
      ] as any);

      await expect(service.getInvitationInfo('invite-code')).resolves.toEqual({
        workspaceName: 'Test Workspace',
        workspaceSlug: 'test-workspace',
        expiresAt: new Date('2026-01-01T00:00:00.000Z'),
        isValid: false,
        reason: 'Invitation has expired',
      });
    });

    it('should return max-uses info when the invitation is exhausted', async () => {
      db.limit.mockResolvedValueOnce([
        {
          invitation: {
            id: 'invitation-uuid',
            tenantId: 'ws-uuid',
            code: 'invite-code',
            createdBy: 'creator-uuid',
            role: 'member',
            maxUses: 2,
            usedCount: 2,
            expiresAt: null,
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          workspace: {
            name: 'Test Workspace',
            slug: 'test-workspace',
          },
          creator: {
            username: 'alice',
            displayName: 'Alice',
          },
        },
      ] as any);

      await expect(service.getInvitationInfo('invite-code')).resolves.toEqual({
        workspaceName: 'Test Workspace',
        workspaceSlug: 'test-workspace',
        isValid: false,
        reason: 'Invitation has reached maximum uses',
      });
    });

    it('should return valid info and invitedBy from the creator display name', async () => {
      const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      db.limit.mockResolvedValueOnce([
        {
          invitation: {
            id: 'invitation-uuid',
            tenantId: 'ws-uuid',
            code: 'invite-code',
            createdBy: 'creator-uuid',
            role: 'member',
            maxUses: 5,
            usedCount: 1,
            expiresAt: futureDate,
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          workspace: {
            name: 'Test Workspace',
            slug: 'test-workspace',
          },
          creator: {
            username: 'alice',
            displayName: null,
          },
        },
      ] as any);

      await expect(service.getInvitationInfo('invite-code')).resolves.toEqual({
        workspaceName: 'Test Workspace',
        workspaceSlug: 'test-workspace',
        invitedBy: 'alice',
        expiresAt: futureDate,
        isValid: true,
      });
    });
  });

  describe('revokeInvitation', () => {
    it('should throw when the invitation cannot be found', async () => {
      db.returning.mockResolvedValueOnce([]);

      await expect(
        service.revokeInvitation('ws-uuid', 'missing-code'),
      ).rejects.toThrow('Invitation not found');
    });

    it('should deactivate the invitation when it exists', async () => {
      db.returning.mockResolvedValueOnce([
        {
          id: 'invitation-uuid',
          isActive: false,
        },
      ] as any);

      await expect(
        service.revokeInvitation('ws-uuid', 'invite-code'),
      ).resolves.toBeUndefined();

      expect(db.update).toHaveBeenCalled();
      expect(db.set).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: false }),
      );
    });
  });

  describe('getWorkspaceMembers', () => {
    it('should reject when the requester is not a member', async () => {
      jest.spyOn(service, 'isWorkspaceMember' as any).mockResolvedValue(false);

      await expect(
        service.getWorkspaceMembers('ws-uuid', 'user-uuid'),
      ).rejects.toThrow('Not a member of this workspace');
    });

    it('should map Redis status and pagination for a member list', async () => {
      jest.spyOn(service, 'isWorkspaceMember' as any).mockResolvedValue(true);
      db.where
        .mockImplementationOnce(() => Promise.resolve([{ count: '2' }]) as any)
        .mockImplementationOnce(() => db as any);
      db.limit.mockReturnValue(db as any);
      db.offset.mockResolvedValueOnce([
        {
          id: 'member-uuid',
          userId: 'online-user',
          username: 'alice',
          displayName: 'Alice',
          avatarUrl: null,
          role: 'admin',
          userType: 'human',
          joinedAt: new Date('2026-04-01T00:00:00.000Z'),
          invitedBy: 'owner-uuid',
          lastSeenAt: null,
        },
      ] as any);
      redisService.hgetall.mockResolvedValueOnce({ 'online-user': 'online' });

      const result = await service.getWorkspaceMembers('ws-uuid', 'user-uuid', {
        page: 2,
        limit: 1,
      });

      expect(result).toEqual({
        members: [
          {
            id: 'member-uuid',
            userId: 'online-user',
            username: 'alice',
            displayName: 'Alice',
            avatarUrl: null,
            role: 'admin',
            status: 'online',
            userType: 'human',
            joinedAt: new Date('2026-04-01T00:00:00.000Z'),
            invitedBy: 'owner-uuid',
            lastSeenAt: null,
          },
        ],
        pagination: {
          page: 2,
          limit: 1,
          total: 2,
          totalPages: 2,
        },
      });
    });
  });

  describe('getOnlineOfflineMemberIds', () => {
    it('should split member ids by the Redis online hash', async () => {
      db.where.mockResolvedValueOnce([
        { userId: 'online-1' },
        { userId: 'offline-1' },
        { userId: 'online-2' },
      ] as any);
      redisService.hgetall.mockResolvedValueOnce({
        'online-1': 'online',
        'online-2': 'online',
      });

      await expect(
        service.getOnlineOfflineMemberIds('ws-uuid'),
      ).resolves.toEqual({
        onlineIds: ['online-1', 'online-2'],
        offlineIds: ['offline-1'],
      });
    });
  });

  describe('getUserWorkspaces', () => {
    it('should map tenant memberships into user workspace summaries', async () => {
      db.orderBy.mockResolvedValueOnce([
        {
          workspace: {
            id: 'ws-1',
            name: 'Workspace One',
            slug: 'workspace-one',
          },
          role: 'owner',
          joinedAt: new Date('2026-04-01T00:00:00.000Z'),
        },
        {
          workspace: {
            id: 'ws-2',
            name: 'Workspace Two',
            slug: 'workspace-two',
          },
          role: 'member',
          joinedAt: new Date('2026-04-02T00:00:00.000Z'),
        },
      ] as any);

      await expect(service.getUserWorkspaces('user-uuid')).resolves.toEqual([
        {
          id: 'ws-1',
          name: 'Workspace One',
          slug: 'workspace-one',
          role: 'owner',
          joinedAt: new Date('2026-04-01T00:00:00.000Z'),
        },
        {
          id: 'ws-2',
          name: 'Workspace Two',
          slug: 'workspace-two',
          role: 'member',
          joinedAt: new Date('2026-04-02T00:00:00.000Z'),
        },
      ]);
    });
  });

  describe('handleUserRegistered', () => {
    it('should create a starter workspace and onboarding record for eligible users', async () => {
      const logger = { log: jest.fn<any>() };
      (service as any).logger = logger;
      jest.spyOn(service, 'create').mockResolvedValue(WORKSPACE_ROW as any);

      await expect(
        service.handleUserRegistered({
          userId: 'user-uuid',
          displayName: 'Alice',
        } as any),
      ).resolves.toBeUndefined();

      expect(service.create).toHaveBeenCalledWith({
        name: "Alice's Workspace",
        ownerId: 'user-uuid',
      });
      expect(onboardingService.createStarterRecord).toHaveBeenCalledWith(
        WORKSPACE_ROW.id,
        'user-uuid',
      );
      expect(logger.log).toHaveBeenCalledWith(
        "Created personal workspace for user user-uuid: Alice's Workspace",
      );
    });

    it('should create a skipped onboarding record for invite signups', async () => {
      jest.spyOn(service, 'create').mockResolvedValue(WORKSPACE_ROW as any);

      await expect(
        service.handleUserRegistered({
          userId: 'user-uuid',
          displayName: 'Alice',
          onboardingEligible: false,
        } as any),
      ).resolves.toBeUndefined();

      expect(onboardingService.createSkippedRecord).toHaveBeenCalledWith(
        WORKSPACE_ROW.id,
        'user-uuid',
      );
      expect(onboardingService.createStarterRecord).not.toHaveBeenCalled();
    });
  });

  describe('getInvitations', () => {
    it('should shape invitation rows into API responses', async () => {
      process.env.APP_URL = 'https://app.team9.test';
      db.orderBy.mockResolvedValueOnce([
        {
          invitation: {
            id: 'inv-1',
            code: 'invite-code',
            role: 'member',
            maxUses: 3,
            usedCount: 1,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            isActive: true,
            createdAt: new Date('2026-04-02T00:00:00.000Z'),
          },
          creator: {
            id: 'creator-1',
            username: 'alice',
            displayName: 'Alice',
          },
        },
      ] as any);

      await expect(service.getInvitations('ws-uuid')).resolves.toEqual([
        {
          id: 'inv-1',
          code: 'invite-code',
          url: 'https://app.team9.test/invite/invite-code',
          role: 'member',
          maxUses: 3,
          usedCount: 1,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          isActive: true,
          createdAt: new Date('2026-04-02T00:00:00.000Z'),
          createdBy: {
            id: 'creator-1',
            username: 'alice',
            displayName: 'Alice',
          },
        },
      ]);
    });
  });

  describe('membership lookup helpers', () => {
    it('should report workspace membership presence', async () => {
      db.limit
        .mockResolvedValueOnce([{ id: 'member-1' }] as any)
        .mockResolvedValueOnce([] as any);

      await expect(
        service.isWorkspaceMember('ws-uuid', 'user-1'),
      ).resolves.toBe(true);
      await expect(
        service.isWorkspaceMember('ws-uuid', 'user-2'),
      ).resolves.toBe(false);
    });

    it('should return workspace ids for active memberships only', async () => {
      db.where.mockResolvedValueOnce([
        { tenantId: 'ws-1' },
        { tenantId: 'ws-2' },
      ] as any);

      await expect(
        service.getWorkspaceIdsByUserId('user-uuid'),
      ).resolves.toEqual(['ws-1', 'ws-2']);
    });

    it('should return a member object and derive member role', async () => {
      db.limit
        .mockResolvedValueOnce([
          {
            id: 'member-1',
            role: 'admin',
            joinedAt: new Date('2026-04-01T00:00:00.000Z'),
          },
        ] as any)
        .mockResolvedValueOnce([
          {
            id: 'member-2',
            role: 'owner',
            joinedAt: new Date('2026-04-02T00:00:00.000Z'),
          },
        ] as any)
        .mockResolvedValueOnce([] as any);

      await expect(service.getMember('ws-uuid', 'user-1')).resolves.toEqual({
        id: 'member-1',
        role: 'admin',
        joinedAt: new Date('2026-04-01T00:00:00.000Z'),
      });
      await expect(service.getMemberRole('ws-uuid', 'user-2')).resolves.toBe(
        'owner',
      );
      await expect(
        service.getMemberRole('ws-uuid', 'user-3'),
      ).resolves.toBeNull();
    });
  });

  describe('workspace lookup helpers', () => {
    it('should find workspaces by id, slug, and domain', async () => {
      (service.findBySlug as MockFn).mockRestore();
      (service.findByDomain as MockFn).mockRestore();

      db.limit
        .mockResolvedValueOnce([WORKSPACE_ROW] as any)
        .mockResolvedValueOnce([
          { ...WORKSPACE_ROW, slug: 'custom-slug' },
        ] as any)
        .mockResolvedValueOnce([
          { ...WORKSPACE_ROW, domain: 'team9.test' },
        ] as any)
        .mockResolvedValueOnce([] as any);

      await expect(service.findById('ws-uuid')).resolves.toEqual(WORKSPACE_ROW);
      await expect(service.findBySlug('custom-slug')).resolves.toEqual({
        ...WORKSPACE_ROW,
        slug: 'custom-slug',
      });
      await expect(service.findByDomain('team9.test')).resolves.toEqual({
        ...WORKSPACE_ROW,
        domain: 'team9.test',
      });
      await expect(
        service.findByIdOrThrow('missing-workspace'),
      ).rejects.toThrow('Workspace not found');
    });
  });

  describe('generateUniqueSlug', () => {
    it('should return the base slug when it is available', async () => {
      (service.generateUniqueSlug as MockFn).mockRestore();
      (service.findBySlug as MockFn).mockResolvedValueOnce(null);

      await expect(
        (service as any).generateUniqueSlug('My Test Workspace'),
      ).resolves.toBe('my-test-workspace');
    });

    it('should fall back to a suffixed slug after repeated collisions', async () => {
      (service.generateUniqueSlug as MockFn).mockRestore();
      (service.findBySlug as MockFn).mockReset();
      (service.findBySlug as MockFn).mockResolvedValue({ id: 'taken' } as any);

      const slug = await (service as any).generateUniqueSlug(
        'My Test Workspace',
      );

      expect(slug).toMatch(/^my-test-workspace-[a-f0-9]{8}$/);
    });
  });

  describe('count helpers', () => {
    it('should convert ownership and member counts to numbers', async () => {
      (service.getUserOwnedWorkspaceCount as MockFn).mockRestore();
      (service.getWorkspaceMemberCount as MockFn).mockRestore();
      db.where
        .mockResolvedValueOnce([{ count: '2' }] as any)
        .mockResolvedValueOnce([{ count: '7' }] as any);

      await expect(
        (service as any).getUserOwnedWorkspaceCount('user-uuid'),
      ).resolves.toBe(2);
      await expect(
        (service as any).getWorkspaceMemberCount('ws-uuid'),
      ).resolves.toBe(7);
    });
  });

  describe('update', () => {
    it('should throw when the workspace cannot be found', async () => {
      db.returning.mockResolvedValueOnce([]);

      await expect(
        service.update('missing-workspace', { name: 'Updated Workspace' }),
      ).rejects.toThrow('Workspace not found');
    });

    it('should update member roles, soft-remove members, and delete workspaces', async () => {
      db.returning.mockResolvedValueOnce([WORKSPACE_ROW] as any);

      await expect(
        service.update('ws-uuid', { name: 'Updated Workspace' }),
      ).resolves.toEqual(WORKSPACE_ROW);

      await expect(
        service.updateMemberRole('ws-uuid', 'user-1', 'admin'),
      ).resolves.toBeUndefined();
      await expect(
        service.removeMember('ws-uuid', 'user-1'),
      ).resolves.toBeUndefined();
      await expect(service.delete('ws-uuid')).resolves.toBeUndefined();

      expect(db.set).toHaveBeenCalledWith({ role: 'admin' });
      expect(db.delete).toHaveBeenCalled();
    });
  });

  describe('getOrCreateDefaultWorkspace', () => {
    it('should create the default workspace when it is missing', async () => {
      jest.spyOn(service, 'findBySlug' as any).mockResolvedValueOnce(null);
      jest.spyOn(service, 'create' as any).mockResolvedValueOnce({
        ...WORKSPACE_ROW,
        slug: 'default',
      });

      await expect(
        service.getOrCreateDefaultWorkspace('owner-uuid'),
      ).resolves.toEqual({
        ...WORKSPACE_ROW,
        slug: 'default',
      });

      expect(service.create).toHaveBeenCalledWith({
        name: 'Default Workspace',
        slug: 'default',
        ownerId: 'owner-uuid',
      });
    });

    it('should add the owner when the default workspace exists but they are missing', async () => {
      jest.spyOn(service, 'findBySlug' as any).mockResolvedValueOnce({
        ...WORKSPACE_ROW,
        slug: 'default',
      });
      jest
        .spyOn(service, 'isWorkspaceMember' as any)
        .mockResolvedValueOnce(false);

      await expect(
        service.getOrCreateDefaultWorkspace('owner-uuid'),
      ).resolves.toEqual({
        ...WORKSPACE_ROW,
        slug: 'default',
      });

      expect(service.addMember).toHaveBeenCalledWith(
        'ws-uuid',
        'owner-uuid',
        'member',
      );
    });
  });

  // ── acceptInvitation ─────────────────────────────────────────────────

  describe('acceptInvitation', () => {
    const INVITATION_ROW = {
      id: 'inv-uuid',
      tenantId: 'ws-uuid',
      code: 'abc123',
      createdBy: 'inviter-uuid',
      role: 'member',
      maxUses: null,
      usedCount: 0,
      expiresAt: null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const USER_ROW = {
      id: 'user-uuid',
      username: 'alice',
      displayName: 'Alice',
      avatarUrl: null,
      status: 'offline',
      email: 'alice@test.com',
    };
    const MEMBER_ROW = {
      id: 'member-uuid',
      tenantId: 'ws-uuid',
      userId: 'user-uuid',
      role: 'member',
      joinedAt: new Date(),
    };
    const WELCOME_CHANNEL = {
      id: 'welcome-channel-uuid',
      tenantId: 'ws-uuid',
      name: 'welcome',
      type: 'public',
    };

    beforeEach(() => {
      let limitCallCount = 0;
      db.limit.mockImplementation((() => {
        limitCallCount++;
        if (limitCallCount === 1) return Promise.resolve([INVITATION_ROW]);
        if (limitCallCount === 2) return Promise.resolve([]); // not existing member
        if (limitCallCount === 3) return Promise.resolve([WORKSPACE_ROW]);
        if (limitCallCount === 4) return Promise.resolve([USER_ROW]);
        return Promise.resolve([]);
      }) as any);

      let returningCallCount = 0;
      db.returning.mockImplementation((() => {
        returningCallCount++;
        if (returningCallCount === 1) return Promise.resolve([MEMBER_ROW]);
        return Promise.resolve([{}]);
      }) as any);

      // Default: no existing workspace members (the query for existingMembers
      // uses innerJoin which resolves via the chained mock → returns [])
      // We override db.where per test when we need members.
      jest
        .spyOn(service, 'getOnlineOfflineMemberIds' as any)
        .mockResolvedValue({
          onlineIds: [],
          offlineIds: [],
        });
    });

    // ── welcome channel ────────────────────────────────────────────

    it('should broadcast system message to welcome channel via WebSocket', async () => {
      channelsService.findByNameAndTenant.mockResolvedValue(WELCOME_CHANNEL);

      await service.acceptInvitation('abc123', 'user-uuid');

      expect(channelsService.addMember).toHaveBeenCalledWith(
        'welcome-channel-uuid',
        'user-uuid',
      );
      expect(channelsService.sendSystemMessage).toHaveBeenCalledWith(
        'welcome-channel-uuid',
        'Alice joined Test Workspace',
      );
      expect(websocketGateway.sendToChannelMembers).toHaveBeenCalledWith(
        'welcome-channel-uuid',
        'new_message',
        expect.objectContaining({
          senderId: null,
          type: 'system',
          sender: null,
        }),
      );
    });

    it('should not fail if welcome channel does not exist', async () => {
      channelsService.findByNameAndTenant.mockResolvedValue(null);

      const result = await service.acceptInvitation('abc123', 'user-uuid');

      expect(result.workspace.id).toBe('ws-uuid');
      expect(channelsService.sendSystemMessage).not.toHaveBeenCalled();
    });

    // ── batch DM creation ──────────────────────────────────────────

    it('should batch-create DM channels for all existing members', async () => {
      // Mock: workspace has 2 human members + 1 bot
      const existingMembers = [
        { userId: 'member-1', userType: 'human' },
        { userId: 'member-2', userType: 'human' },
        { userId: 'bot-1', userType: 'bot' },
      ];
      // Override .where to return members on the existingMembers query (6th where call).
      // where calls: 1=invitation, 2=existingMember check, 3=update invitation,
      //              4=workspace, 5=user, 6=existingMembers (terminal, no .limit)
      let whereCallCount = 0;
      db.where.mockImplementation((() => {
        whereCallCount++;
        if (whereCallCount === 6) return Promise.resolve(existingMembers);
        return db; // return chain to allow further chaining (.limit, etc.)
      }) as any);

      const dmMap = new Map([
        ['member-1', { id: 'dm-1', tenantId: 'ws-uuid', type: 'direct' }],
        ['member-2', { id: 'dm-2', tenantId: 'ws-uuid', type: 'direct' }],
        ['bot-1', { id: 'dm-bot', tenantId: 'ws-uuid', type: 'direct' }],
      ]);
      channelsService.createDirectChannelsBatch.mockResolvedValue(dmMap);

      await service.acceptInvitation('abc123', 'user-uuid');

      // Should call batch method with all member IDs
      expect(channelsService.createDirectChannelsBatch).toHaveBeenCalledWith(
        'user-uuid',
        ['member-1', 'member-2', 'bot-1'],
        'ws-uuid',
      );

      // Should send system message for human members only, not bot
      expect(channelsService.sendSystemMessage).toHaveBeenCalledWith(
        'dm-1',
        'Alice joined Test Workspace. Say hello!',
      );
      expect(channelsService.sendSystemMessage).toHaveBeenCalledWith(
        'dm-2',
        'Alice joined Test Workspace. Say hello!',
      );
      // Bot DM should NOT get a system message
      expect(channelsService.sendSystemMessage).not.toHaveBeenCalledWith(
        'dm-bot',
        expect.any(String),
      );
    });

    it('should not fail invitation if batch DM creation throws', async () => {
      // Make the existingMembers query return members
      let whereCallCount = 0;
      db.where.mockImplementation((() => {
        whereCallCount++;
        if (whereCallCount === 6)
          return Promise.resolve([{ userId: 'member-1', userType: 'human' }]);
        return db; // return chain to allow further chaining
      }) as any);

      channelsService.createDirectChannelsBatch.mockRejectedValue(
        new Error('Batch failed'),
      );

      const result = await service.acceptInvitation('abc123', 'user-uuid');

      expect(result.workspace.id).toBe('ws-uuid');
    });

    it('should throw when workspace has reached max member limit (1000)', async () => {
      (service as any).getWorkspaceMemberCount.mockResolvedValue(1000);

      await expect(
        service.acceptInvitation('abc123', 'user-uuid'),
      ).rejects.toThrow('Workspace has reached the maximum of 1000 members');
    });

    it('should throw when the invitation does not exist', async () => {
      db.limit.mockReset();
      db.limit.mockResolvedValueOnce([] as any);

      await expect(
        service.acceptInvitation('missing-code', 'user-uuid'),
      ).rejects.toThrow('Invitation not found');
    });

    it('should throw when the invitation has been revoked', async () => {
      db.limit.mockReset();
      db.limit.mockResolvedValueOnce([
        {
          ...INVITATION_ROW,
          isActive: false,
        },
      ] as any);

      await expect(
        service.acceptInvitation('abc123', 'user-uuid'),
      ).rejects.toThrow('Invitation has been revoked');
    });

    it('should throw when the invitation has expired', async () => {
      db.limit.mockReset();
      db.limit.mockResolvedValueOnce([
        {
          ...INVITATION_ROW,
          expiresAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ] as any);

      await expect(
        service.acceptInvitation('abc123', 'user-uuid'),
      ).rejects.toThrow('Invitation has expired');
    });

    it('should throw when the invitation has reached maximum uses', async () => {
      db.limit.mockReset();
      db.limit.mockResolvedValueOnce([
        {
          ...INVITATION_ROW,
          maxUses: 2,
          usedCount: 2,
        },
      ] as any);

      await expect(
        service.acceptInvitation('abc123', 'user-uuid'),
      ).rejects.toThrow('Invitation has reached maximum uses');
    });

    it('should throw when the user is already a workspace member', async () => {
      db.limit.mockReset();
      db.limit
        .mockResolvedValueOnce([INVITATION_ROW] as any)
        .mockResolvedValueOnce([
          {
            id: 'existing-member',
            tenantId: 'ws-uuid',
            userId: 'user-uuid',
          },
        ] as any);

      await expect(
        service.acceptInvitation('abc123', 'user-uuid'),
      ).rejects.toThrow('You are already a member of this workspace');
    });
  });

  // ── addMember: member limit ────────────────────────────────────────

  describe('addMember – member limit', () => {
    beforeEach(() => {
      // Restore real addMember so we can test it
      (service.addMember as MockFn).mockRestore();
      // Stub getMember to return null (not already a member)
      jest.spyOn(service, 'getMember' as any).mockResolvedValue(null);
    });

    it('should throw when workspace has reached max member limit (1000)', async () => {
      (service as any).getWorkspaceMemberCount.mockResolvedValue(1000);

      await expect(
        service.addMember('ws-uuid', 'new-user', 'member'),
      ).rejects.toThrow('Workspace has reached the maximum of 1000 members');
    });

    it('should allow adding member when below limit', async () => {
      (service as any).getWorkspaceMemberCount.mockResolvedValue(999);

      await service.addMember('ws-uuid', 'new-user', 'member');

      expect(db.insert).toHaveBeenCalled();
    });

    it('should reject duplicate workspace members before insert', async () => {
      (service.getMember as MockFn).mockResolvedValue({
        id: 'member-1',
        role: 'member',
        joinedAt: new Date(),
      } as any);

      await expect(
        service.addMember('ws-uuid', 'new-user', 'member'),
      ).rejects.toThrow('User is already a member of this workspace');

      expect(db.insert).not.toHaveBeenCalled();
    });
  });
});

import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { WorkspaceService } from './workspace.service.js';
import { BotService } from '../bot/bot.service.js';
import { ChannelsService } from '../im/channels/channels.service.js';
import { RedisService } from '@team9/redis';
import { DATABASE_CONNECTION } from '@team9/database';
import { WEBSOCKET_GATEWAY } from '../shared/constants/injection-tokens.js';

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
    'innerJoin',
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
    createWorkspaceBot: MockFn;
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
    sendToChannel: MockFn;
  };

  beforeEach(async () => {
    db = mockDb();
    botService = {
      getBotUserId: jest.fn<any>().mockReturnValue(null),
      createWorkspaceBot: jest.fn<any>().mockResolvedValue({
        userId: 'custom-bot-user',
        botId: 'custom-bot-id',
      }),
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
      sendToChannel: jest.fn<any>(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspaceService,
        { provide: DATABASE_CONNECTION, useValue: db },
        { provide: WEBSOCKET_GATEWAY, useValue: websocketGateway },
        {
          provide: RedisService,
          useValue: { hgetall: jest.fn<any>().mockResolvedValue({}) },
        },
        { provide: ChannelsService, useValue: channelsService },
        { provide: BotService, useValue: botService },
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
  });

  // ── create: custom bot ────────────────────────────────────────────

  describe('create', () => {
    beforeEach(() => {
      db.returning.mockResolvedValue([WORKSPACE_ROW] as any);
    });

    it('should call createWorkspaceBot with ownerId and workspace id', async () => {
      await service.create({ name: 'Test Workspace', ownerId: 'owner-1' });

      expect(botService.createWorkspaceBot).toHaveBeenCalledWith(
        'owner-1',
        'ws-uuid',
      );
    });

    it('should call createWorkspaceBot even when system bot is disabled', async () => {
      botService.getBotUserId.mockReturnValue(null);

      await service.create({ name: 'Test Workspace', ownerId: 'owner-1' });

      expect(botService.createWorkspaceBot).toHaveBeenCalledTimes(1);
    });

    it('should call createWorkspaceBot alongside system bot when system bot is enabled', async () => {
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

      // Custom bot also created
      expect(botService.createWorkspaceBot).toHaveBeenCalledWith(
        'owner-1',
        'ws-uuid',
      );
    });

    it('should not fail workspace creation if custom bot creation fails', async () => {
      botService.createWorkspaceBot.mockRejectedValue(
        new Error('Bot creation failed'),
      );

      const result = await service.create({
        name: 'Test Workspace',
        ownerId: 'owner-1',
      });

      expect(result).toEqual(WORKSPACE_ROW);
      expect(botService.createWorkspaceBot).toHaveBeenCalled();
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
      // Custom bot should still be created even if system bot fails
      expect(botService.createWorkspaceBot).toHaveBeenCalled();
    });

    it('should create welcome channel before bots', async () => {
      const callOrder: string[] = [];
      channelsService.create.mockImplementation((() => {
        callOrder.push('welcome-channel');
        return Promise.resolve({});
      }) as any);
      botService.createWorkspaceBot.mockImplementation((() => {
        callOrder.push('workspace-bot');
        return Promise.resolve({ userId: 'b', botId: 'b' });
      }) as any);

      await service.create({ name: 'Test Workspace', ownerId: 'owner-1' });

      expect(callOrder).toEqual(['welcome-channel', 'workspace-bot']);
    });

    it('should add owner as member with owner role', async () => {
      await service.create({ name: 'Test Workspace', ownerId: 'owner-1' });

      expect(service.addMember).toHaveBeenCalledWith(
        'ws-uuid',
        'owner-1',
        'owner',
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
      expect(websocketGateway.sendToChannel).toHaveBeenCalledWith(
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
  });
});

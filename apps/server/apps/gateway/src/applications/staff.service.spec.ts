import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { StaffService } from './staff.service.js';

type MockFn = jest.Mock<(...args: any[]) => any>;

function mockDb() {
  const chain: Record<string, MockFn> = {} as Record<string, MockFn>;
  for (const method of ['update', 'set', 'where']) {
    chain[method] = jest.fn<any>().mockReturnValue(chain);
  }
  chain.then = jest.fn<any>((resolve: (value: unknown) => unknown) =>
    Promise.resolve([]).then(resolve),
  );
  return chain;
}

describe('StaffService', () => {
  let service: StaffService;
  let db: ReturnType<typeof mockDb>;
  let botService: {
    createWorkspaceBot: MockFn;
    updateBotExtra: MockFn;
    deleteBotAndCleanup: MockFn;
  };
  let clawHiveService: {
    registerAgent: MockFn;
    deleteAgent: MockFn;
  };

  beforeEach(() => {
    db = mockDb();
    botService = {
      createWorkspaceBot: jest.fn<any>().mockResolvedValue({
        bot: {
          botId: 'bot-1',
          userId: 'bot-user-1',
          displayName: 'Analyst',
        },
        accessToken: 'token-1',
      }),
      updateBotExtra: jest.fn<any>().mockResolvedValue(undefined),
      deleteBotAndCleanup: jest.fn<any>().mockResolvedValue(undefined),
    };
    clawHiveService = {
      registerAgent: jest.fn<any>().mockResolvedValue(undefined),
      deleteAgent: jest.fn<any>().mockResolvedValue(undefined),
    };

    service = new StaffService(
      db as never,
      botService as never,
      clawHiveService as never,
      { get: jest.fn<any>(), set: jest.fn<any>() } as never,
    );
  });

  it('passes nullable mentor to bot creation and Hive metadata', async () => {
    await service.createBotWithAgent({
      agentIdPrefix: 'common-staff',
      blueprintId: 'team9-common-staff',
      ownerId: 'owner-1',
      tenantId: 'tenant-1',
      displayName: 'Analyst',
      installedApplicationId: 'app-1',
      mentorId: null,
      model: { provider: 'openrouter', id: 'anthropic/claude-sonnet-4.6' },
      botExtra: { commonStaff: { roleTitle: 'Analyst' } },
    });

    expect(botService.createWorkspaceBot).toHaveBeenCalledWith(
      expect.objectContaining({ mentorId: null }),
    );
    expect(clawHiveService.registerAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ mentorId: null }),
      }),
    );
  });

  it('stores managed metadata extras with the generated agent id', async () => {
    await service.createBotWithAgent({
      agentIdPrefix: 'common-staff',
      blueprintId: 'team9-common-staff',
      ownerId: 'owner-1',
      tenantId: 'tenant-1',
      displayName: 'Analyst',
      installedApplicationId: 'app-1',
      mentorId: null,
      model: { provider: 'openrouter', id: 'anthropic/claude-sonnet-4.6' },
      botExtra: {
        commonStaff: {
          roleTitle: 'Analyst',
          prefabTemplateId: 'template-1',
        },
      },
      managedMeta: { prefabTemplateId: 'template-1' },
    });

    expect(db.set).toHaveBeenCalledWith(
      expect.objectContaining({
        managedMeta: {
          agentId: 'common-staff-bot-1',
          prefabTemplateId: 'template-1',
        },
      }),
    );
  });
});

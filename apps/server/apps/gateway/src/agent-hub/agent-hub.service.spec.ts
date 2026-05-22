import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals';
import { AgentHubService } from './agent-hub.service.js';

type MockFn = jest.Mock<(...args: any[]) => any>;

const now = new Date('2026-05-22T00:00:00.000Z').getTime();

function makeTemplate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sales-analyst',
    name: 'Sales Analyst',
    description: 'Analyzes pipeline health',
    blueprintId: 'team9-common-staff',
    model: { provider: 'openrouter', id: 'anthropic/claude-sonnet-4.6' },
    componentConfigs: { 'system-prompt': { prompt: 'Analyze sales data.' } },
    metadata: {
      team9: {
        displayName: 'Sales Analyst',
        roleTitle: 'Sales Operations Analyst',
        shortRoleTitle: 'Sales Ops',
        unique: true,
      },
    },
    ...overrides,
  };
}

describe('AgentHubService catalog', () => {
  let service: AgentHubService;
  let clawHive: { listPrefabAgentTemplates: MockFn };
  let redis: { get: MockFn; set: MockFn };
  let installedApplications: {
    findByApplicationId: MockFn;
    ensureAutoInstallApps: MockFn;
  };
  let staffService: {
    createBotWithAgent: MockFn;
    generateShortRoleTitle: MockFn;
  };
  let botService: { getBotsByInstalledApplicationId: MockFn };
  let channelsService: { createDirectChannel: MockFn };
  let db: { select: MockFn };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(now);

    clawHive = { listPrefabAgentTemplates: jest.fn<any>() };
    redis = {
      get: jest.fn<any>().mockResolvedValue(null),
      set: jest.fn<any>().mockResolvedValue('OK'),
    };
    installedApplications = {
      findByApplicationId: jest.fn<any>(),
      ensureAutoInstallApps: jest.fn<any>(),
    };
    staffService = {
      createBotWithAgent: jest.fn<any>(),
      generateShortRoleTitle: jest.fn<any>(),
    };
    botService = {
      getBotsByInstalledApplicationId: jest.fn<any>().mockResolvedValue([]),
    };
    channelsService = { createDirectChannel: jest.fn<any>() };
    db = { select: jest.fn<any>() };

    service = new AgentHubService(
      clawHive as never,
      redis as never,
      installedApplications as never,
      staffService as never,
      botService as never,
      channelsService as never,
      db as never,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('filters and normalizes templates with Team9 metadata', async () => {
    clawHive.listPrefabAgentTemplates.mockResolvedValue([
      makeTemplate(),
      makeTemplate({
        id: 'missing-team9',
        metadata: {},
      }),
      makeTemplate({
        id: 'missing-role',
        metadata: { team9: { displayName: 'No Role' } },
      }),
    ]);
    installedApplications.findByApplicationId.mockResolvedValue({
      id: 'common-app-1',
    });

    const result = await service.listRecommendedStaff('tenant-1');

    expect(result).toEqual([
      expect.objectContaining({
        templateId: 'sales-analyst',
        displayName: 'Sales Analyst',
        roleTitle: 'Sales Operations Analyst',
        shortRoleTitle: 'Sales Ops',
        unique: true,
        installed: false,
      }),
    ]);
    expect(redis.set).toHaveBeenCalledWith(
      'agent-hub:team9-prefab-staff:v1',
      expect.any(String),
      24 * 60 * 60,
    );
  });

  it('uses a fresh Redis cache without calling AgentHive', async () => {
    redis.get.mockResolvedValue(
      JSON.stringify({
        cachedAt: new Date(now).toISOString(),
        templates: [
          {
            templateId: 'cached-template',
            name: 'Cached',
            displayName: 'Cached',
            roleTitle: 'Cached Role',
            shortRoleTitle: null,
            persona: null,
            jobDescription: null,
            avatarUrl: null,
            description: null,
            model: {
              provider: 'openrouter',
              id: 'anthropic/claude-sonnet-4.6',
            },
            blueprintId: 'team9-common-staff',
            componentConfigs: {},
            unique: false,
          },
        ],
      }),
    );
    installedApplications.findByApplicationId.mockResolvedValue({
      id: 'common-app-1',
    });

    const result = await service.listRecommendedStaff('tenant-1');

    expect(result[0]).toMatchObject({
      templateId: 'cached-template',
      installed: false,
    });
    expect(clawHive.listPrefabAgentTemplates).not.toHaveBeenCalled();
  });

  it('returns stale cache when AgentHive refresh fails', async () => {
    redis.get.mockResolvedValue(
      JSON.stringify({
        cachedAt: new Date(now - 10 * 60 * 1000).toISOString(),
        templates: [
          {
            templateId: 'stale-template',
            name: 'Stale',
            displayName: 'Stale',
            roleTitle: 'Stale Role',
            shortRoleTitle: null,
            persona: null,
            jobDescription: null,
            avatarUrl: null,
            description: null,
            model: {
              provider: 'openrouter',
              id: 'anthropic/claude-sonnet-4.6',
            },
            blueprintId: 'team9-common-staff',
            componentConfigs: {},
            unique: false,
          },
        ],
      }),
    );
    clawHive.listPrefabAgentTemplates.mockRejectedValue(new Error('down'));
    installedApplications.findByApplicationId.mockResolvedValue({
      id: 'common-app-1',
    });

    const result = await service.listRecommendedStaff('tenant-1');

    expect(result[0]).toMatchObject({
      templateId: 'stale-template',
      installed: false,
    });
  });

  it('computes installed state from Common Staff bots', async () => {
    clawHive.listPrefabAgentTemplates.mockResolvedValue([makeTemplate()]);
    installedApplications.findByApplicationId.mockResolvedValue({
      id: 'common-app-1',
    });
    botService.getBotsByInstalledApplicationId.mockResolvedValue([
      {
        botId: 'bot-1',
        isActive: true,
        managedMeta: { prefabTemplateId: 'sales-analyst' },
        extra: {},
      },
    ]);

    const result = await service.listRecommendedStaff('tenant-1');

    expect(result[0]).toMatchObject({
      installed: true,
      installedBotId: 'bot-1',
    });
  });
});

import { ServiceUnavailableException } from '@nestjs/common';
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

  it('treats malformed cached template entries as missing cache and refreshes from AgentHive', async () => {
    redis.get.mockResolvedValue(
      JSON.stringify({
        cachedAt: new Date(now).toISOString(),
        templates: [null],
      }),
    );
    clawHive.listPrefabAgentTemplates.mockResolvedValue([makeTemplate()]);
    installedApplications.findByApplicationId.mockResolvedValue({
      id: 'common-app-1',
    });

    const result = await service.listRecommendedStaff('tenant-1');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      templateId: 'sales-analyst',
      installed: false,
    });
    expect(clawHive.listPrefabAgentTemplates).toHaveBeenCalledTimes(1);
  });

  it('returns fresh AgentHive results when Redis cache write fails', async () => {
    clawHive.listPrefabAgentTemplates.mockResolvedValue([makeTemplate()]);
    redis.set.mockRejectedValue(new Error('redis down'));
    installedApplications.findByApplicationId.mockResolvedValue({
      id: 'common-app-1',
    });

    const result = await service.listRecommendedStaff('tenant-1');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      templateId: 'sales-analyst',
      installed: false,
    });
  });

  it('rejects malformed Team9 model provider and id instead of falling back', async () => {
    clawHive.listPrefabAgentTemplates.mockResolvedValue([
      makeTemplate({
        id: 'bad-provider',
        metadata: {
          team9: {
            roleTitle: 'Bad Provider',
            model: { provider: 123, id: 'anthropic/claude-sonnet-4.6' },
          },
        },
      }),
      makeTemplate({
        id: 'bad-id',
        metadata: {
          team9: {
            roleTitle: 'Bad Id',
            model: { provider: 'openrouter', id: false },
          },
        },
      }),
      makeTemplate({
        id: 'valid-template-model',
        metadata: {
          team9: {
            roleTitle: 'Valid Template Model',
          },
        },
      }),
    ]);
    installedApplications.findByApplicationId.mockResolvedValue({
      id: 'common-app-1',
    });

    const result = await service.listRecommendedStaff('tenant-1');

    expect(result).toEqual([
      expect.objectContaining({
        templateId: 'valid-template-model',
        roleTitle: 'Valid Template Model',
      }),
    ]);
  });

  it('rejects malformed Hive template model instead of falling back to default', async () => {
    clawHive.listPrefabAgentTemplates.mockResolvedValue([
      makeTemplate({
        id: 'bad-template-model',
        model: { provider: 123, id: 'x' },
        metadata: {
          team9: {
            roleTitle: 'Bad Template Model',
          },
        },
      }),
      makeTemplate({
        id: 'valid-template-model',
        metadata: {
          team9: {
            roleTitle: 'Valid Template Model',
          },
        },
      }),
    ]);
    installedApplications.findByApplicationId.mockResolvedValue({
      id: 'common-app-1',
    });

    const result = await service.listRecommendedStaff('tenant-1');

    expect(result).toEqual([
      expect.objectContaining({
        templateId: 'valid-template-model',
      }),
    ]);
  });

  it('returns unavailable instead of stale cache when cachedAt is invalid and AgentHive fails', async () => {
    redis.get.mockResolvedValue(
      JSON.stringify({
        cachedAt: 'not-a-date',
        templates: [
          {
            templateId: 'invalid-date-template',
            name: 'Invalid Date',
            displayName: 'Invalid Date',
            roleTitle: 'Invalid Date Role',
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

    await expect(service.listRecommendedStaff('tenant-1')).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('returns fresh AgentHive results when Redis cache read fails', async () => {
    redis.get.mockRejectedValue(new Error('redis read down'));
    clawHive.listPrefabAgentTemplates.mockResolvedValue([makeTemplate()]);
    installedApplications.findByApplicationId.mockResolvedValue({
      id: 'common-app-1',
    });

    const result = await service.listRecommendedStaff('tenant-1');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      templateId: 'sales-analyst',
      installed: false,
    });
  });

  it('skips Hive templates with empty id, name, or blueprintId', async () => {
    clawHive.listPrefabAgentTemplates.mockResolvedValue([
      makeTemplate({ id: '' }),
      makeTemplate({ id: 'empty-name', name: '   ' }),
      makeTemplate({ id: 'empty-blueprint', blueprintId: '' }),
      makeTemplate({ id: 'valid-required-fields' }),
    ]);
    installedApplications.findByApplicationId.mockResolvedValue({
      id: 'common-app-1',
    });

    const result = await service.listRecommendedStaff('tenant-1');

    expect(result).toEqual([
      expect.objectContaining({
        templateId: 'valid-required-fields',
      }),
    ]);
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

  it('computes installed state from Common Staff bot extra metadata fallback', async () => {
    clawHive.listPrefabAgentTemplates.mockResolvedValue([makeTemplate()]);
    installedApplications.findByApplicationId.mockResolvedValue({
      id: 'common-app-1',
    });
    botService.getBotsByInstalledApplicationId.mockResolvedValue([
      {
        botId: 'bot-extra',
        isActive: true,
        managedMeta: {},
        extra: { commonStaff: { prefabTemplateId: 'sales-analyst' } },
      },
    ]);

    const result = await service.listRecommendedStaff('tenant-1');

    expect(result[0]).toMatchObject({
      installed: true,
      installedBotId: 'bot-extra',
    });
  });

  it('ignores inactive Common Staff bots when computing installed state', async () => {
    clawHive.listPrefabAgentTemplates.mockResolvedValue([makeTemplate()]);
    installedApplications.findByApplicationId.mockResolvedValue({
      id: 'common-app-1',
    });
    botService.getBotsByInstalledApplicationId.mockResolvedValue([
      {
        botId: 'inactive-bot',
        isActive: false,
        managedMeta: { prefabTemplateId: 'sales-analyst' },
        extra: {},
      },
    ]);

    const result = await service.listRecommendedStaff('tenant-1');

    expect(result[0]).toMatchObject({
      installed: false,
    });
    expect(result[0]).not.toHaveProperty('installedBotId');
  });
});

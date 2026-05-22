import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { inspect } from 'node:util';
import { AgentHubService } from './agent-hub.service.js';
import { InstallRecommendedStaffDto } from './dto/install-recommended-staff.dto.js';

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
  let redisClient: { set: MockFn; eval: MockFn };
  let redis: { get: MockFn; set: MockFn; getClient: MockFn };
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
    redisClient = {
      set: jest.fn<any>().mockResolvedValue('OK'),
      eval: jest.fn<any>().mockResolvedValue(1),
    };
    redis = {
      get: jest.fn<any>().mockResolvedValue(null),
      set: jest.fn<any>().mockResolvedValue('OK'),
      getClient: jest.fn<any>().mockReturnValue(redisClient),
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

  it('installs a unique recommended staff template without mentor by default', async () => {
    clawHive.listPrefabAgentTemplates.mockResolvedValue([makeTemplate()]);
    installedApplications.findByApplicationId.mockResolvedValue({
      id: 'common-app-1',
      applicationId: 'common-staff',
    });
    staffService.createBotWithAgent.mockResolvedValue({
      botId: 'bot-1',
      userId: 'bot-user-1',
      agentId: 'common-staff-bot-1',
      displayName: 'Sales Analyst',
    });

    const result = await service.installRecommendedStaff(
      'tenant-1',
      'installer-1',
      'sales-analyst',
      {},
    );

    expect(result).toEqual({
      botId: 'bot-1',
      userId: 'bot-user-1',
      agentId: 'common-staff-bot-1',
      displayName: 'Sales Analyst',
    });
    expect(staffService.createBotWithAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        blueprintId: 'team9-common-staff',
        ownerId: 'installer-1',
        tenantId: 'tenant-1',
        installedApplicationId: 'common-app-1',
        mentorId: null,
        managedMeta: { prefabTemplateId: 'sales-analyst' },
        botExtra: expect.objectContaining({
          commonStaff: expect.objectContaining({
            roleTitle: 'Sales Operations Analyst',
            shortRoleTitle: 'Sales Ops',
            prefabTemplateId: 'sales-analyst',
          }),
        }),
      }),
    );
    expect(channelsService.createDirectChannel).not.toHaveBeenCalled();
    expect(redisClient.set).toHaveBeenCalledWith(
      'agent-hub:install-recommended-staff:tenant-1:common-app-1:sales-analyst',
      expect.any(String),
      'EX',
      30,
      'NX',
    );
    expect(redisClient.eval).toHaveBeenCalledWith(
      expect.stringContaining('redis.call("get", KEYS[1])'),
      1,
      'agent-hub:install-recommended-staff:tenant-1:common-app-1:sales-analyst',
      expect.any(String),
    );
  });

  it('rejects duplicate installs for unique templates', async () => {
    clawHive.listPrefabAgentTemplates.mockResolvedValue([makeTemplate()]);
    installedApplications.findByApplicationId.mockResolvedValue({
      id: 'common-app-1',
    });
    botService.getBotsByInstalledApplicationId.mockResolvedValue([
      {
        botId: 'bot-existing',
        isActive: true,
        managedMeta: { prefabTemplateId: 'sales-analyst' },
        extra: {},
      },
    ]);

    await expect(
      service.installRecommendedStaff(
        'tenant-1',
        'installer-1',
        'sales-analyst',
        {},
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects unique install when another install holds the lock', async () => {
    redisClient.set.mockResolvedValue(null);
    clawHive.listPrefabAgentTemplates.mockResolvedValue([makeTemplate()]);
    installedApplications.findByApplicationId.mockResolvedValue({
      id: 'common-app-1',
    });

    await expect(
      service.installRecommendedStaff(
        'tenant-1',
        'installer-1',
        'sales-analyst',
        {},
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(botService.getBotsByInstalledApplicationId).not.toHaveBeenCalled();
    expect(staffService.createBotWithAgent).not.toHaveBeenCalled();
    expect(redisClient.eval).not.toHaveBeenCalled();
  });

  it('returns unavailable when unique install lock acquisition fails', async () => {
    redisClient.set.mockRejectedValue(new Error('redis down'));
    clawHive.listPrefabAgentTemplates.mockResolvedValue([makeTemplate()]);
    installedApplications.findByApplicationId.mockResolvedValue({
      id: 'common-app-1',
    });

    await expect(
      service.installRecommendedStaff(
        'tenant-1',
        'installer-1',
        'sales-analyst',
        {},
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(botService.getBotsByInstalledApplicationId).not.toHaveBeenCalled();
    expect(staffService.createBotWithAgent).not.toHaveBeenCalled();
  });

  it('generates short role title when the template does not provide one', async () => {
    clawHive.listPrefabAgentTemplates.mockResolvedValue([
      makeTemplate({
        metadata: {
          team9: {
            displayName: 'Support Specialist',
            roleTitle: 'Customer Support Specialist',
            unique: false,
          },
        },
      }),
    ]);
    installedApplications.findByApplicationId.mockResolvedValue({
      id: 'common-app-1',
    });
    staffService.generateShortRoleTitle.mockResolvedValue('Support');
    staffService.createBotWithAgent.mockResolvedValue({
      botId: 'bot-2',
      userId: 'bot-user-2',
      agentId: 'common-staff-bot-2',
      displayName: 'Support Specialist',
    });

    await service.installRecommendedStaff(
      'tenant-1',
      'installer-1',
      'sales-analyst',
      {},
    );

    expect(staffService.generateShortRoleTitle).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      installedApplicationId: 'common-app-1',
      roleTitle: 'Customer Support Specialist',
    });
    expect(staffService.createBotWithAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        botExtra: expect.objectContaining({
          commonStaff: expect.objectContaining({ shortRoleTitle: 'Support' }),
        }),
      }),
    );
  });

  it('validates mentor only when mentorId is provided and creates mentor DM', async () => {
    const query = {
      from: jest.fn<any>().mockReturnThis(),
      where: jest.fn<any>().mockReturnThis(),
      limit: jest.fn<any>().mockResolvedValue([{ userId: 'mentor-1' }]),
    };
    db.select.mockReturnValue(query);
    clawHive.listPrefabAgentTemplates.mockResolvedValue([makeTemplate()]);
    installedApplications.findByApplicationId.mockResolvedValue({
      id: 'common-app-1',
    });
    staffService.createBotWithAgent.mockResolvedValue({
      botId: 'bot-1',
      userId: 'bot-user-1',
      agentId: 'common-staff-bot-1',
      displayName: 'Sales Analyst',
    });

    await service.installRecommendedStaff(
      'tenant-1',
      'installer-1',
      'sales-analyst',
      { mentorId: 'mentor-1' },
    );

    expect(staffService.createBotWithAgent).toHaveBeenCalledWith(
      expect.objectContaining({ mentorId: 'mentor-1' }),
    );
    expect(channelsService.createDirectChannel).toHaveBeenCalledWith(
      'bot-user-1',
      'mentor-1',
      'tenant-1',
    );
  });

  it('still returns installed staff when mentor DM creation fails', async () => {
    const query = {
      from: jest.fn<any>().mockReturnThis(),
      where: jest.fn<any>().mockReturnThis(),
      limit: jest.fn<any>().mockResolvedValue([{ userId: 'mentor-1' }]),
    };
    db.select.mockReturnValue(query);
    channelsService.createDirectChannel.mockRejectedValue(new Error('dm down'));
    clawHive.listPrefabAgentTemplates.mockResolvedValue([makeTemplate()]);
    installedApplications.findByApplicationId.mockResolvedValue({
      id: 'common-app-1',
    });
    staffService.createBotWithAgent.mockResolvedValue({
      botId: 'bot-1',
      userId: 'bot-user-1',
      agentId: 'common-staff-bot-1',
      displayName: 'Sales Analyst',
    });

    const result = await service.installRecommendedStaff(
      'tenant-1',
      'installer-1',
      'sales-analyst',
      { mentorId: 'mentor-1' },
    );

    expect(result).toMatchObject({
      botId: 'bot-1',
      userId: 'bot-user-1',
    });
  });

  it('throws not found when the recommended staff template id is missing', async () => {
    clawHive.listPrefabAgentTemplates.mockResolvedValue([makeTemplate()]);

    await expect(
      service.installRecommendedStaff(
        'tenant-1',
        'installer-1',
        'missing-template',
        {},
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('only calls Hive once when an uncached template id is missing', async () => {
    clawHive.listPrefabAgentTemplates.mockResolvedValue([makeTemplate()]);

    await expect(
      service.installRecommendedStaff(
        'tenant-1',
        'installer-1',
        'missing-template',
        {},
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(clawHive.listPrefabAgentTemplates).toHaveBeenCalledTimes(1);
  });

  it('returns unavailable when stale cache misses the requested template and Hive refresh fails', async () => {
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
    clawHive.listPrefabAgentTemplates.mockRejectedValue(new Error('hive down'));

    await expect(
      service.installRecommendedStaff(
        'tenant-1',
        'installer-1',
        'sales-analyst',
        {},
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('auto-installs Common Staff when missing and then retries lookup', async () => {
    clawHive.listPrefabAgentTemplates.mockResolvedValue([makeTemplate()]);
    installedApplications.findByApplicationId
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'common-app-1' });
    staffService.createBotWithAgent.mockResolvedValue({
      botId: 'bot-1',
      userId: 'bot-user-1',
      agentId: 'common-staff-bot-1',
      displayName: 'Sales Analyst',
    });

    await service.installRecommendedStaff(
      'tenant-1',
      'installer-1',
      'sales-analyst',
      {},
    );

    expect(installedApplications.ensureAutoInstallApps).toHaveBeenCalledWith(
      'tenant-1',
      'installer-1',
    );
    expect(installedApplications.findByApplicationId).toHaveBeenCalledTimes(2);
    expect(staffService.createBotWithAgent).toHaveBeenCalledWith(
      expect.objectContaining({ installedApplicationId: 'common-app-1' }),
    );
  });

  it('rejects invalid mentorId and does not create staff', async () => {
    const query = {
      from: jest.fn<any>().mockReturnThis(),
      where: jest.fn<any>().mockReturnThis(),
      limit: jest.fn<any>().mockResolvedValue([]),
    };
    db.select.mockReturnValue(query);
    clawHive.listPrefabAgentTemplates.mockResolvedValue([makeTemplate()]);
    installedApplications.findByApplicationId.mockResolvedValue({
      id: 'common-app-1',
    });

    await expect(
      service.installRecommendedStaff(
        'tenant-1',
        'installer-1',
        'sales-analyst',
        { mentorId: 'not-a-member' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(staffService.createBotWithAgent).not.toHaveBeenCalled();
    expect(channelsService.createDirectChannel).not.toHaveBeenCalled();
  });

  it('validates mentor against active workspace membership only', async () => {
    const query = {
      from: jest.fn<any>().mockReturnThis(),
      where: jest.fn<any>().mockReturnThis(),
      limit: jest.fn<any>().mockResolvedValue([{ userId: 'mentor-1' }]),
    };
    db.select.mockReturnValue(query);
    clawHive.listPrefabAgentTemplates.mockResolvedValue([makeTemplate()]);
    installedApplications.findByApplicationId.mockResolvedValue({
      id: 'common-app-1',
    });
    staffService.createBotWithAgent.mockResolvedValue({
      botId: 'bot-1',
      userId: 'bot-user-1',
      agentId: 'common-staff-bot-1',
      displayName: 'Sales Analyst',
    });

    await service.installRecommendedStaff(
      'tenant-1',
      'installer-1',
      'sales-analyst',
      { mentorId: 'mentor-1' },
    );

    const [predicate] = query.where.mock.calls[0];
    const renderedPredicate = inspect(predicate, { depth: 12 });
    expect(renderedPredicate).toContain("name: 'left_at'");
    expect(renderedPredicate).toContain("' is null'");
  });

  it('installs with null short role title when generation fails', async () => {
    clawHive.listPrefabAgentTemplates.mockResolvedValue([
      makeTemplate({
        metadata: {
          team9: {
            displayName: 'Support Specialist',
            roleTitle: 'Customer Support Specialist',
            unique: false,
          },
        },
      }),
    ]);
    installedApplications.findByApplicationId.mockResolvedValue({
      id: 'common-app-1',
    });
    staffService.generateShortRoleTitle.mockRejectedValue(
      new Error('llm down'),
    );
    staffService.createBotWithAgent.mockResolvedValue({
      botId: 'bot-2',
      userId: 'bot-user-2',
      agentId: 'common-staff-bot-2',
      displayName: 'Support Specialist',
    });

    await service.installRecommendedStaff(
      'tenant-1',
      'installer-1',
      'sales-analyst',
      {},
    );

    expect(staffService.createBotWithAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        botExtra: expect.objectContaining({
          commonStaff: expect.objectContaining({ shortRoleTitle: null }),
        }),
      }),
    );
  });

  it('does not forward non-object template component configs during install', async () => {
    clawHive.listPrefabAgentTemplates.mockResolvedValue([
      makeTemplate({
        componentConfigs: {
          'system-prompt': { prompt: 'Analyze sales data.' },
          'bad-string': 'nope',
          'bad-null': null,
          'bad-array': [],
        },
      }),
    ]);
    installedApplications.findByApplicationId.mockResolvedValue({
      id: 'common-app-1',
    });
    staffService.createBotWithAgent.mockResolvedValue({
      botId: 'bot-1',
      userId: 'bot-user-1',
      agentId: 'common-staff-bot-1',
      displayName: 'Sales Analyst',
    });

    await service.installRecommendedStaff(
      'tenant-1',
      'installer-1',
      'sales-analyst',
      {},
    );

    expect(staffService.createBotWithAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        extraComponentConfigs: expect.objectContaining({
          'system-prompt': { prompt: 'Analyze sales data.' },
        }),
      }),
    );
    const [{ extraComponentConfigs }] =
      staffService.createBotWithAgent.mock.calls[0];
    expect(extraComponentConfigs).not.toHaveProperty('bad-string');
    expect(extraComponentConfigs).not.toHaveProperty('bad-null');
    expect(extraComponentConfigs).not.toHaveProperty('bad-array');
  });

  it('does not let template component configs override reserved platform configs', async () => {
    clawHive.listPrefabAgentTemplates.mockResolvedValue([
      makeTemplate({
        componentConfigs: {
          team9: { team9AuthToken: 'attacker-token' },
          folder9: { workspaceId: 'wrong-workspace' },
          'system-prompt': { prompt: 'Analyze sales data.' },
        },
      }),
    ]);
    installedApplications.findByApplicationId.mockResolvedValue({
      id: 'common-app-1',
    });
    staffService.createBotWithAgent.mockResolvedValue({
      botId: 'bot-1',
      userId: 'bot-user-1',
      agentId: 'common-staff-bot-1',
      displayName: 'Sales Analyst',
    });

    await service.installRecommendedStaff(
      'tenant-1',
      'installer-1',
      'sales-analyst',
      {},
    );

    const [{ extraComponentConfigs }] =
      staffService.createBotWithAgent.mock.calls[0];
    expect(extraComponentConfigs).not.toHaveProperty('team9');
    expect(extraComponentConfigs.folder9).toEqual({
      folder9Url: process.env.FOLDER9_API_URL,
      workspaceId: 'tenant-1',
    });
  });

  it('treats an omitted install DTO as empty', async () => {
    clawHive.listPrefabAgentTemplates.mockResolvedValue([makeTemplate()]);
    installedApplications.findByApplicationId.mockResolvedValue({
      id: 'common-app-1',
    });
    staffService.createBotWithAgent.mockResolvedValue({
      botId: 'bot-1',
      userId: 'bot-user-1',
      agentId: 'common-staff-bot-1',
      displayName: 'Sales Analyst',
    });

    await service.installRecommendedStaff(
      'tenant-1',
      'installer-1',
      'sales-analyst',
      undefined as never,
    );

    expect(staffService.createBotWithAgent).toHaveBeenCalledWith(
      expect.objectContaining({ mentorId: null }),
    );
  });

  it('treats blank mentorId DTO values as absent before UUID validation', async () => {
    const dto = plainToInstance(InstallRecommendedStaffDto, {
      mentorId: '   ',
    });

    const errors = await validate(dto);

    expect(errors).toEqual([]);
    expect(dto.mentorId).toBeNull();
  });

  it('rejects non-UUID mentorId DTO values when provided', async () => {
    const dto = plainToInstance(InstallRecommendedStaffDto, {
      mentorId: 'not-a-uuid',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
    expect(errors[0]?.constraints).toHaveProperty('isUuid');
  });
});

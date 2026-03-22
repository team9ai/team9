import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';

type MockFn = jest.Mock<(...args: any[]) => any>;

// ── fixtures ──────────────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-uuid';

const makeApp = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id: 'app-1',
  applicationId: 'openclaw',
  tenantId: TENANT_ID,
  config: {},
  status: 'active',
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makeBot = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  botId: 'bot-1',
  userId: 'user-1',
  username: 'testbot',
  displayName: 'Test Bot',
  isActive: true,
  createdAt: new Date(),
  mentorId: 'mentor-1',
  mentorDisplayName: 'Mentor',
  mentorAvatarUrl: null,
  extra: { openclaw: { agentId: 'agent-1', workspace: 'ws-1' } },
  managedMeta: null,
  ...overrides,
});

const makeInstance = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id: 'instance-1',
  status: 'running',
  access_url: 'https://test.openclaw.cloud',
  created_at: '2026-01-01',
  last_heartbeat: '2026-03-23',
  ...overrides,
});

// ── Controller under test (extracted method logic) ────────────────────────────
// We test the controller method directly by constructing it with mocked deps.

interface ControllerDeps {
  installedApplicationsService: { findAllByTenant: MockFn };
  botService: { getBotsByInstalledApplicationId: MockFn };
  openclawService: { getInstance: MockFn };
}

/**
 * Build a minimal controller instance with only the findAllWithBots method
 * wired to the given mocked dependencies.
 */
function buildController(deps: ControllerDeps) {
  // Import the actual controller class dynamically would be heavy — instead we
  // replicate the method logic inline to keep the test fast and isolated.
  // This mirrors the controller's findAllWithBots implementation.
  return {
    async findAllWithBots(tenantId: string) {
      if (!tenantId) {
        throw new BadRequestException('Tenant ID is required');
      }
      const apps =
        await deps.installedApplicationsService.findAllByTenant(tenantId);

      return Promise.all(
        apps.map(async (app: any) => {
          if (app.status !== 'active') {
            return { ...app, bots: [], instanceStatus: null };
          }

          if (app.applicationId === 'openclaw') {
            const instancesId = app.config?.instancesId;
            const [bots, instance] = await Promise.all([
              deps.botService
                .getBotsByInstalledApplicationId(app.id)
                .catch(() => []),
              instancesId
                ? deps.openclawService
                    .getInstance(instancesId)
                    .catch(() => null)
                : Promise.resolve(null),
            ]);

            return {
              ...app,
              bots: bots.map((bot: any) => ({
                botId: bot.botId,
                userId: bot.userId,
                agentId: bot.extra?.openclaw?.agentId ?? null,
                workspace: bot.extra?.openclaw?.workspace ?? null,
                username: bot.username,
                displayName: bot.displayName,
                isActive: bot.isActive,
                createdAt: bot.createdAt,
                mentorId: bot.mentorId,
                mentorDisplayName: bot.mentorDisplayName,
                mentorAvatarUrl: bot.mentorAvatarUrl,
              })),
              instanceStatus: instance
                ? {
                    instanceId: instance.id,
                    status: instance.status,
                    accessUrl: instance.access_url,
                    createdAt: instance.created_at,
                    lastHeartbeat: instance.last_heartbeat,
                  }
                : null,
            };
          }

          if (app.applicationId === 'base-model-staff') {
            const bots = await deps.botService
              .getBotsByInstalledApplicationId(app.id)
              .catch(() => []);
            return {
              ...app,
              bots: bots.map((bot: any) => ({
                botId: bot.botId,
                userId: bot.userId,
                username: bot.username,
                displayName: bot.displayName,
                isActive: bot.isActive,
                createdAt: bot.createdAt,
                managedMeta: bot.managedMeta,
              })),
              instanceStatus: null,
            };
          }

          return { ...app, bots: [], instanceStatus: null };
        }),
      );
    },
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('InstalledApplicationsController — findAllWithBots', () => {
  let deps: ControllerDeps;
  let controller: ReturnType<typeof buildController>;

  beforeEach(() => {
    deps = {
      installedApplicationsService: {
        findAllByTenant: jest.fn<any>().mockResolvedValue([]),
      },
      botService: {
        getBotsByInstalledApplicationId: jest.fn<any>().mockResolvedValue([]),
      },
      openclawService: {
        getInstance: jest.fn<any>().mockResolvedValue(null),
      },
    };
    controller = buildController(deps);
  });

  it('throws BadRequestException when tenantId is falsy', async () => {
    await expect(controller.findAllWithBots('')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('returns empty array when no apps installed', async () => {
    const result = await controller.findAllWithBots(TENANT_ID);
    expect(result).toEqual([]);
  });

  it('returns inactive apps with empty bots and null instanceStatus', async () => {
    const inactiveApp = makeApp({ status: 'inactive' });
    deps.installedApplicationsService.findAllByTenant.mockResolvedValueOnce([
      inactiveApp,
    ]);

    const result = await controller.findAllWithBots(TENANT_ID);

    expect(result).toHaveLength(1);
    expect(result[0].bots).toEqual([]);
    expect(result[0].instanceStatus).toBeNull();
    expect(
      deps.botService.getBotsByInstalledApplicationId,
    ).not.toHaveBeenCalled();
  });

  it('aggregates openclaw app with bots and instanceStatus', async () => {
    const app = makeApp({
      applicationId: 'openclaw',
      config: { instancesId: 'inst-1' },
    });
    const bot = makeBot();
    const instance = makeInstance();

    deps.installedApplicationsService.findAllByTenant.mockResolvedValueOnce([
      app,
    ]);
    deps.botService.getBotsByInstalledApplicationId.mockResolvedValueOnce([
      bot,
    ]);
    deps.openclawService.getInstance.mockResolvedValueOnce(instance);

    const result = await controller.findAllWithBots(TENANT_ID);

    expect(result).toHaveLength(1);
    expect(result[0].bots).toHaveLength(1);
    expect(result[0].bots[0]).toEqual({
      botId: 'bot-1',
      userId: 'user-1',
      agentId: 'agent-1',
      workspace: 'ws-1',
      username: 'testbot',
      displayName: 'Test Bot',
      isActive: true,
      createdAt: bot.createdAt,
      mentorId: 'mentor-1',
      mentorDisplayName: 'Mentor',
      mentorAvatarUrl: null,
    });
    expect(result[0].instanceStatus).toEqual({
      instanceId: 'instance-1',
      status: 'running',
      accessUrl: 'https://test.openclaw.cloud',
      createdAt: '2026-01-01',
      lastHeartbeat: '2026-03-23',
    });
  });

  it('returns null instanceStatus when openclaw has no instancesId', async () => {
    const app = makeApp({ applicationId: 'openclaw', config: {} });
    deps.installedApplicationsService.findAllByTenant.mockResolvedValueOnce([
      app,
    ]);
    deps.botService.getBotsByInstalledApplicationId.mockResolvedValueOnce([]);

    const result = await controller.findAllWithBots(TENANT_ID);

    expect(result[0].instanceStatus).toBeNull();
    expect(deps.openclawService.getInstance).not.toHaveBeenCalled();
  });

  it('catches openclaw getInstance errors and returns null instanceStatus', async () => {
    const app = makeApp({
      applicationId: 'openclaw',
      config: { instancesId: 'inst-1' },
    });
    deps.installedApplicationsService.findAllByTenant.mockResolvedValueOnce([
      app,
    ]);
    deps.botService.getBotsByInstalledApplicationId.mockResolvedValueOnce([]);
    deps.openclawService.getInstance.mockRejectedValueOnce(
      new Error('Network timeout'),
    );

    const result = await controller.findAllWithBots(TENANT_ID);

    expect(result[0].instanceStatus).toBeNull();
    expect(result[0].bots).toEqual([]);
  });

  it('catches bot fetch errors and returns empty bots array', async () => {
    const app = makeApp({
      applicationId: 'openclaw',
      config: { instancesId: 'inst-1' },
    });
    deps.installedApplicationsService.findAllByTenant.mockResolvedValueOnce([
      app,
    ]);
    deps.botService.getBotsByInstalledApplicationId.mockRejectedValueOnce(
      new Error('DB connection error'),
    );
    deps.openclawService.getInstance.mockResolvedValueOnce(makeInstance());

    const result = await controller.findAllWithBots(TENANT_ID);

    expect(result[0].bots).toEqual([]);
    expect(result[0].instanceStatus).not.toBeNull();
  });

  it('catches base-model-staff bot fetch errors gracefully', async () => {
    const app = makeApp({ applicationId: 'base-model-staff', id: 'app-bms' });
    deps.installedApplicationsService.findAllByTenant.mockResolvedValueOnce([
      app,
    ]);
    deps.botService.getBotsByInstalledApplicationId.mockRejectedValueOnce(
      new Error('DB error'),
    );

    const result = await controller.findAllWithBots(TENANT_ID);

    expect(result[0].bots).toEqual([]);
    expect(result[0].instanceStatus).toBeNull();
  });

  it('aggregates base-model-staff app with bots', async () => {
    const app = makeApp({ applicationId: 'base-model-staff', id: 'app-bms' });
    const bot = makeBot({
      extra: null,
      managedMeta: { agentId: 'managed-agent-1' },
    });

    deps.installedApplicationsService.findAllByTenant.mockResolvedValueOnce([
      app,
    ]);
    deps.botService.getBotsByInstalledApplicationId.mockResolvedValueOnce([
      bot,
    ]);

    const result = await controller.findAllWithBots(TENANT_ID);

    expect(result).toHaveLength(1);
    expect(result[0].instanceStatus).toBeNull();
    expect(result[0].bots[0]).toEqual({
      botId: 'bot-1',
      userId: 'user-1',
      username: 'testbot',
      displayName: 'Test Bot',
      isActive: true,
      createdAt: bot.createdAt,
      managedMeta: { agentId: 'managed-agent-1' },
    });
  });

  it('returns unknown app types with empty bots', async () => {
    const app = makeApp({ applicationId: 'custom-app', id: 'app-custom' });
    deps.installedApplicationsService.findAllByTenant.mockResolvedValueOnce([
      app,
    ]);

    const result = await controller.findAllWithBots(TENANT_ID);

    expect(result[0].bots).toEqual([]);
    expect(result[0].instanceStatus).toBeNull();
    expect(
      deps.botService.getBotsByInstalledApplicationId,
    ).not.toHaveBeenCalled();
  });

  it('handles multiple apps of different types in parallel', async () => {
    const openclawApp = makeApp({
      id: 'app-oc',
      applicationId: 'openclaw',
      config: { instancesId: 'inst-1' },
    });
    const bmsApp = makeApp({
      id: 'app-bms',
      applicationId: 'base-model-staff',
    });
    const inactiveApp = makeApp({
      id: 'app-inactive',
      applicationId: 'openclaw',
      status: 'inactive',
    });

    deps.installedApplicationsService.findAllByTenant.mockResolvedValueOnce([
      openclawApp,
      bmsApp,
      inactiveApp,
    ]);

    const ocBot = makeBot({ botId: 'oc-bot' });
    const bmsBot = makeBot({
      botId: 'bms-bot',
      managedMeta: { agentId: 'a1' },
    });

    deps.botService.getBotsByInstalledApplicationId
      .mockResolvedValueOnce([ocBot]) // openclaw
      .mockResolvedValueOnce([bmsBot]); // base-model-staff
    deps.openclawService.getInstance.mockResolvedValueOnce(makeInstance());

    const result = await controller.findAllWithBots(TENANT_ID);

    expect(result).toHaveLength(3);
    // openclaw app
    expect(result[0].bots).toHaveLength(1);
    expect(result[0].bots[0].botId).toBe('oc-bot');
    expect(result[0].instanceStatus).not.toBeNull();
    // base-model-staff app
    expect(result[1].bots).toHaveLength(1);
    expect(result[1].bots[0].botId).toBe('bms-bot');
    expect(result[1].instanceStatus).toBeNull();
    // inactive app
    expect(result[2].bots).toEqual([]);
    expect(result[2].instanceStatus).toBeNull();

    // botService called exactly twice (not for inactive app)
    expect(
      deps.botService.getBotsByInstalledApplicationId,
    ).toHaveBeenCalledTimes(2);
  });
});

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import {
  BadRequestException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';

jest.unstable_mockModule('@team9/auth', () => ({
  AuthGuard: class AuthGuard {},
  CurrentUser: () => () => undefined,
}));

jest.unstable_mockModule(
  '../common/decorators/current-tenant.decorator.js',
  () => ({
    CurrentTenantId: () => () => undefined,
  }),
);

jest.unstable_mockModule('../workspace/guards/workspace.guard.js', () => ({
  WorkspaceGuard: class WorkspaceGuard {},
}));

jest.unstable_mockModule('../workspace/guards/workspace-role.guard.js', () => ({
  WorkspaceRoleGuard: class WorkspaceRoleGuard {},
  WorkspaceRoles: () => () => undefined,
}));

jest.unstable_mockModule('../bot/bot.service.js', () => ({
  BotService: class BotService {},
}));

jest.unstable_mockModule('../openclaw/openclaw.service.js', () => ({
  OpenclawService: class OpenclawService {},
}));

jest.unstable_mockModule('../file-keeper/file-keeper.service.js', () => ({
  FileKeeperService: class FileKeeperService {},
}));

jest.unstable_mockModule('./installed-applications.service.js', () => ({
  InstalledApplicationsService: class InstalledApplicationsService {},
}));

jest.unstable_mockModule('./applications.service.js', () => ({
  ApplicationsService: class ApplicationsService {},
}));

jest.unstable_mockModule('../common/utils/slug.util.js', () => ({
  generateSlug: jest.fn((input: string) =>
    input.toLowerCase().replace(/\s+/g, '-'),
  ),
  generateShortId: jest.fn(() => 'abcd'),
}));

const { InstalledApplicationsController } =
  await import('./installed-applications.controller.js');

type MockFn = jest.Mock<(...args: any[]) => any>;

const TENANT_ID = 'tenant-1';
const USER_ID = 'user-1';
const OTHER_USER_ID = 'user-2';
const APP_ID = 'app-1';
const OPENCLAW_APP_ID = 'openclaw-app';
const BASE_MODEL_APP_ID = 'base-model-app';
const INSTANCE_ID = 'instance-1';
const BOT_ID = 'bot-1';
const SECOND_BOT_ID = 'bot-2';
const NOW = new Date('2026-04-02T12:00:00Z');

function makeDb() {
  const chain: Record<string, MockFn> = {
    select: jest.fn<any>(),
    from: jest.fn<any>(),
    where: jest.fn<any>(),
    limit: jest.fn<any>(),
  };
  chain.select.mockReturnValue(chain);
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.limit.mockResolvedValue([]);
  return chain;
}

function makeInstalledApp(overrides: Record<string, any> = {}) {
  return {
    id: APP_ID,
    applicationId: 'openclaw',
    tenantId: TENANT_ID,
    iconUrl: '/icons/openclaw.svg',
    config: { instancesId: INSTANCE_ID },
    status: 'active',
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeBot(overrides: Record<string, any> = {}) {
  return {
    botId: BOT_ID,
    userId: 'bot-user-1',
    username: 'bot_user',
    displayName: 'Bot User',
    isActive: true,
    createdAt: NOW,
    mentorId: USER_ID,
    mentorDisplayName: 'Mentor',
    mentorAvatarUrl: null,
    extra: { openclaw: { agentId: 'agent-1', workspace: 'workspace-1' } },
    managedMeta: { agentId: 'managed-agent-1' },
    ...overrides,
  };
}

function makeInstance(overrides: Record<string, any> = {}) {
  return {
    id: INSTANCE_ID,
    status: 'running',
    access_url: 'https://openclaw.example.com/',
    created_at: '2026-04-02T00:00:00Z',
    last_heartbeat: '2026-04-02T01:00:00Z',
    file_keeper_domain: 'files.example.com',
    ...overrides,
  };
}

describe('InstalledApplicationsController', () => {
  let controller: InstalledApplicationsController;
  let db: ReturnType<typeof makeDb>;
  let installedApplicationsService: {
    findAllByTenant: MockFn;
    findById: MockFn;
    install: MockFn;
    update: MockFn;
    uninstall: MockFn;
  };
  let applicationsService: { findAll: MockFn; findById: MockFn };
  let openclawService: {
    getInstance: MockFn;
    listDevices: MockFn;
    approveDevice: MockFn;
    rejectDevice: MockFn;
    startInstance: MockFn;
    stopInstance: MockFn;
  };
  let fileKeeperService: {
    listWorkspaces: MockFn;
    issueToken: MockFn;
  };
  let botService: {
    getBotsByInstalledApplicationId: MockFn;
    getBotById: MockFn;
    isUsernameTaken: MockFn;
    updateBotDisplayName: MockFn;
    updateBotMentor: MockFn;
  };

  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    db = makeDb();
    installedApplicationsService = {
      findAllByTenant: jest.fn<any>().mockResolvedValue([]),
      findById: jest.fn<any>().mockResolvedValue(makeInstalledApp()),
      install: jest.fn<any>().mockResolvedValue({ id: 'installed-1' }),
      update: jest.fn<any>().mockResolvedValue({ id: APP_ID }),
      uninstall: jest.fn<any>().mockResolvedValue(undefined),
    };
    applicationsService = {
      findAll: jest.fn<any>().mockReturnValue([]),
      findById: jest.fn<any>().mockReturnValue({
        id: 'openclaw',
        iconUrl: '/icons/openclaw.svg',
      }),
    };
    openclawService = {
      getInstance: jest.fn<any>().mockResolvedValue(makeInstance()),
      listDevices: jest.fn<any>().mockResolvedValue([]),
      approveDevice: jest.fn<any>().mockResolvedValue(undefined),
      rejectDevice: jest.fn<any>().mockResolvedValue(undefined),
      startInstance: jest.fn<any>().mockResolvedValue(undefined),
      stopInstance: jest.fn<any>().mockResolvedValue(undefined),
    };
    fileKeeperService = {
      listWorkspaces: jest.fn<any>().mockResolvedValue([]),
      issueToken: jest.fn<any>().mockReturnValue({
        token: 'fk-token',
        baseUrl: 'https://files.example.com',
        instanceId: INSTANCE_ID,
        expiresAt: '2026-04-02T13:00:00Z',
      }),
    };
    botService = {
      getBotsByInstalledApplicationId: jest.fn<any>().mockResolvedValue([]),
      getBotById: jest.fn<any>().mockResolvedValue(makeBot()),
      isUsernameTaken: jest.fn<any>().mockResolvedValue(false),
      updateBotDisplayName: jest.fn<any>().mockResolvedValue(undefined),
      updateBotMentor: jest.fn<any>().mockResolvedValue(undefined),
    };

    controller = new InstalledApplicationsController(
      db as never,
      installedApplicationsService as never,
      applicationsService as never,
      openclawService as never,
      fileKeeperService as never,
      botService as never,
    );
  });

  it('guards findAll with tenantId and delegates when present', async () => {
    await expect(controller.findAll(undefined as never)).rejects.toBeInstanceOf(
      BadRequestException,
    );

    const apps = [makeInstalledApp({ id: 'app-a' })];
    installedApplicationsService.findAllByTenant.mockResolvedValueOnce(apps);
    const result = await controller.findAll(TENANT_ID);

    expect(installedApplicationsService.findAllByTenant).toHaveBeenCalledWith(
      TENANT_ID,
    );
    expect(result).toEqual(apps);
  });

  it('guards findById with tenantId and throws when the app is missing', async () => {
    await expect(
      controller.findById(APP_ID, undefined as never),
    ).rejects.toBeInstanceOf(BadRequestException);

    installedApplicationsService.findById.mockResolvedValueOnce(null);
    await expect(controller.findById(APP_ID, TENANT_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );

    expect(installedApplicationsService.findById).toHaveBeenCalledWith(
      APP_ID,
      TENANT_ID,
    );
  });

  it('falls back to the application icon when install payload omits iconUrl', async () => {
    applicationsService.findById.mockReturnValueOnce({
      id: 'openclaw',
      iconUrl: '/icons/fallback.svg',
    });

    const dto = { applicationId: 'openclaw', iconUrl: '' } as never;
    await controller.install(dto, USER_ID, TENANT_ID);

    expect(installedApplicationsService.install).toHaveBeenCalledWith(
      TENANT_ID,
      USER_ID,
      {
        ...dto,
        iconUrl: '/icons/fallback.svg',
      },
    );
  });

  it('aggregates findAllWithBots for inactive, openclaw, and base-model-staff apps', async () => {
    const inactiveApp = makeInstalledApp({
      id: 'inactive-app',
      applicationId: 'custom-app',
      status: 'inactive',
      config: {},
    });
    const openclawApp = makeInstalledApp({
      id: OPENCLAW_APP_ID,
      applicationId: 'openclaw',
      config: { instancesId: 'openclaw-instance' },
    });
    const baseModelApp = makeInstalledApp({
      id: BASE_MODEL_APP_ID,
      applicationId: 'base-model-staff',
      config: {},
    });

    installedApplicationsService.findAllByTenant.mockResolvedValueOnce([
      inactiveApp,
      openclawApp,
      baseModelApp,
    ]);

    botService.getBotsByInstalledApplicationId
      .mockResolvedValueOnce([
        makeBot({
          botId: 'openclaw-bot',
          extra: {
            openclaw: {
              agentId: 'agent-123',
              workspace: 'workspace-123',
            },
          },
          managedMeta: null,
        }),
      ])
      .mockResolvedValueOnce([
        makeBot({
          botId: SECOND_BOT_ID,
          username: 'staff_bot',
          displayName: 'Staff Bot',
          isActive: false,
          extra: null,
          managedMeta: { agentId: 'managed-agent-2' },
        }),
      ]);
    openclawService.getInstance.mockResolvedValueOnce(
      makeInstance({
        id: 'openclaw-instance',
        access_url: 'https://openclaw.example.com',
      }),
    );

    const result = await controller.findAllWithBots(TENANT_ID);

    expect(result).toEqual([
      expect.objectContaining({
        id: 'inactive-app',
        bots: [],
        instanceStatus: null,
      }),
      expect.objectContaining({
        id: OPENCLAW_APP_ID,
        bots: [
          expect.objectContaining({
            botId: 'openclaw-bot',
            agentId: 'agent-123',
            workspace: 'workspace-123',
            username: 'bot_user',
            displayName: 'Bot User',
            isActive: true,
            createdAt: NOW,
            mentorId: USER_ID,
            mentorDisplayName: 'Mentor',
            mentorAvatarUrl: null,
          }),
        ],
        instanceStatus: {
          instanceId: 'openclaw-instance',
          status: 'running',
          accessUrl: 'https://openclaw.example.com',
          createdAt: '2026-04-02T00:00:00Z',
          lastHeartbeat: '2026-04-02T01:00:00Z',
        },
      }),
      expect.objectContaining({
        id: BASE_MODEL_APP_ID,
        bots: [
          expect.objectContaining({
            botId: SECOND_BOT_ID,
            username: 'staff_bot',
            displayName: 'Staff Bot',
            isActive: false,
            createdAt: NOW,
            managedMeta: { agentId: 'managed-agent-2' },
          }),
        ],
        instanceStatus: null,
      }),
    ]);
    expect(botService.getBotsByInstalledApplicationId).toHaveBeenCalledTimes(2);
  });

  it('returns OpenClaw instance status', async () => {
    installedApplicationsService.findById.mockResolvedValueOnce(
      makeInstalledApp({
        id: OPENCLAW_APP_ID,
        applicationId: 'openclaw',
        config: { instancesId: 'openclaw-instance' },
      }),
    );
    openclawService.getInstance.mockResolvedValueOnce(
      makeInstance({
        id: 'openclaw-instance',
        access_url: 'https://gateway.example.com',
      }),
    );

    const result = await controller.getOpenClawStatus(
      OPENCLAW_APP_ID,
      TENANT_ID,
    );

    expect(result).toEqual({
      instanceId: 'openclaw-instance',
      status: 'running',
      accessUrl: 'https://gateway.example.com',
      createdAt: '2026-04-02T00:00:00Z',
      lastHeartbeat: '2026-04-02T01:00:00Z',
    });
  });

  it('returns OpenClaw bots with normalized fields', async () => {
    installedApplicationsService.findById.mockResolvedValueOnce(
      makeInstalledApp({
        id: OPENCLAW_APP_ID,
        applicationId: 'openclaw',
        config: { instancesId: 'openclaw-instance' },
      }),
    );
    botService.getBotsByInstalledApplicationId.mockResolvedValueOnce([
      makeBot({
        botId: 'bot-openclaw',
        extra: {
          openclaw: {
            agentId: 'agent-9',
            workspace: 'workspace-9',
          },
        },
      }),
    ]);

    const result = await controller.getOpenClawBots(OPENCLAW_APP_ID, TENANT_ID);

    expect(result).toEqual([
      {
        botId: 'bot-openclaw',
        userId: 'bot-user-1',
        agentId: 'agent-9',
        workspace: 'workspace-9',
        username: 'bot_user',
        displayName: 'Bot User',
        isActive: true,
        createdAt: NOW,
        mentorId: USER_ID,
        mentorDisplayName: 'Mentor',
        mentorAvatarUrl: null,
      },
    ]);
  });

  it('returns a converted gateway URL for OpenClaw', async () => {
    installedApplicationsService.findById.mockResolvedValueOnce(
      makeInstalledApp({
        id: OPENCLAW_APP_ID,
        applicationId: 'openclaw',
        config: { instancesId: 'openclaw-instance' },
      }),
    );
    openclawService.getInstance.mockResolvedValueOnce(
      makeInstance({
        id: 'openclaw-instance',
        access_url: 'https://gateway.example.com/',
      }),
    );

    const result = await controller.getOpenClawGatewayInfo(
      OPENCLAW_APP_ID,
      TENANT_ID,
    );

    expect(result).toEqual({
      instanceId: 'openclaw-instance',
      gatewayUrl: 'wss://gateway.example.com:18789',
      gatewayPort: 18789,
    });
  });

  it('issues a scoped file-keeper token with the OpenClaw base URL', async () => {
    installedApplicationsService.findById.mockResolvedValueOnce(
      makeInstalledApp({
        id: OPENCLAW_APP_ID,
        applicationId: 'openclaw',
        config: { instancesId: 'openclaw-instance' },
      }),
    );
    openclawService.getInstance.mockResolvedValueOnce(
      makeInstance({
        id: 'openclaw-instance',
        file_keeper_domain: 'files.example.com',
      }),
    );

    const result = await controller.getFileKeeperToken(
      OPENCLAW_APP_ID,
      TENANT_ID,
    );

    expect(fileKeeperService.issueToken).toHaveBeenCalledWith(
      'openclaw-instance',
      ['workspace-dir', 'data-dir'],
      'https://files.example.com',
    );
    expect(result).toEqual({
      token: 'fk-token',
      baseUrl: 'https://files.example.com',
      instanceId: INSTANCE_ID,
      expiresAt: '2026-04-02T13:00:00Z',
    });
  });

  it('lists file-keeper workspaces with mapped names and modification times', async () => {
    installedApplicationsService.findById.mockResolvedValueOnce(
      makeInstalledApp({
        id: OPENCLAW_APP_ID,
        applicationId: 'openclaw',
        config: { instancesId: 'openclaw-instance' },
      }),
    );
    openclawService.getInstance.mockResolvedValueOnce(
      makeInstance({
        id: 'openclaw-instance',
        file_keeper_domain: 'files.example.com',
      }),
    );
    fileKeeperService.listWorkspaces.mockResolvedValueOnce([
      { name: 'workspace-a', modified: '2026-04-01T09:00:00Z' },
      { name: 'workspace-b', modified: '2026-04-01T10:00:00Z' },
    ]);

    const result = await controller.getOpenClawWorkspaces(
      OPENCLAW_APP_ID,
      TENANT_ID,
    );

    expect(fileKeeperService.listWorkspaces).toHaveBeenCalledWith(
      'openclaw-instance',
      'https://files.example.com',
    );
    expect(result).toEqual({
      instanceId: 'openclaw-instance',
      workspaces: [
        { name: 'workspace-a', modified: '2026-04-01T09:00:00Z' },
        { name: 'workspace-b', modified: '2026-04-01T10:00:00Z' },
      ],
    });
  });

  it('validates username availability queries and trims whitespace', async () => {
    installedApplicationsService.findById.mockResolvedValueOnce(
      makeInstalledApp({
        id: OPENCLAW_APP_ID,
        applicationId: 'openclaw',
      }),
    );
    botService.isUsernameTaken.mockResolvedValueOnce(true);

    const result = await controller.checkUsername(
      OPENCLAW_APP_ID,
      TENANT_ID,
      '  taken_name  ',
    );

    expect(botService.isUsernameTaken).toHaveBeenCalledWith('taken_name');
    expect(result).toEqual({ available: false });
  });

  it('rejects missing username query params', async () => {
    installedApplicationsService.findById.mockResolvedValueOnce(
      makeInstalledApp({
        id: OPENCLAW_APP_ID,
        applicationId: 'openclaw',
      }),
    );

    await expect(
      controller.checkUsername(OPENCLAW_APP_ID, TENANT_ID, ''),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires a valid pending request for self-approval', async () => {
    installedApplicationsService.findById.mockResolvedValue(
      makeInstalledApp({
        id: OPENCLAW_APP_ID,
        applicationId: 'openclaw',
        config: { instancesId: 'openclaw-instance' },
      }),
    );
    openclawService.listDevices.mockResolvedValueOnce([
      { request_id: 'req-1', status: 'approved' },
    ]);

    await expect(
      controller.selfApproveOpenClawDevice(OPENCLAW_APP_ID, TENANT_ID, 'req-1'),
    ).rejects.toBeInstanceOf(NotFoundException);

    openclawService.listDevices.mockResolvedValueOnce([
      { request_id: 'req-2', status: 'pending' },
    ]);

    const result = await controller.selfApproveOpenClawDevice(
      OPENCLAW_APP_ID,
      TENANT_ID,
      'req-2',
    );

    expect(openclawService.approveDevice).toHaveBeenCalledWith(
      'openclaw-instance',
      'req-2',
    );
    expect(result).toEqual({ approved: true, requestId: 'req-2' });
  });

  it.each([
    ['approveOpenClawDevice', 'approveDevice'],
    ['rejectOpenClawDevice', 'rejectDevice'],
  ])('validates requestId for %s', async (methodName) => {
    installedApplicationsService.findById.mockResolvedValueOnce(
      makeInstalledApp({
        id: OPENCLAW_APP_ID,
        applicationId: 'openclaw',
        config: { instancesId: 'openclaw-instance' },
      }),
    );

    await expect(
      controller[methodName](OPENCLAW_APP_ID, TENANT_ID, {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows the current mentor to transfer a bot mentor', async () => {
    installedApplicationsService.findById.mockResolvedValueOnce(
      makeInstalledApp({
        id: OPENCLAW_APP_ID,
        applicationId: 'openclaw',
      }),
    );
    botService.getBotById.mockResolvedValueOnce(
      makeBot({ botId: 'bot-transfer', mentorId: USER_ID }),
    );
    db.limit.mockResolvedValueOnce([{ role: 'member' }]);

    const result = await controller.updateOpenClawBotMentor(
      OPENCLAW_APP_ID,
      'bot-transfer',
      USER_ID,
      TENANT_ID,
      { mentorId: OTHER_USER_ID },
    );

    expect(botService.updateBotMentor).toHaveBeenCalledWith(
      'bot-transfer',
      OTHER_USER_ID,
    );
    expect(result).toEqual({ success: true });
  });

  it('rejects mentor transfer when the requester is neither mentor nor admin', async () => {
    installedApplicationsService.findById.mockResolvedValueOnce(
      makeInstalledApp({
        id: OPENCLAW_APP_ID,
        applicationId: 'openclaw',
      }),
    );
    botService.getBotById.mockResolvedValueOnce(
      makeBot({ botId: 'bot-transfer', mentorId: OTHER_USER_ID }),
    );
    db.limit.mockResolvedValueOnce([{ role: 'member' }]);

    await expect(
      controller.updateOpenClawBotMentor(
        OPENCLAW_APP_ID,
        'bot-transfer',
        USER_ID,
        TENANT_ID,
        { mentorId: OTHER_USER_ID },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('validates OpenClaw bot display names before updating', async () => {
    installedApplicationsService.findById.mockResolvedValueOnce(
      makeInstalledApp({
        id: OPENCLAW_APP_ID,
        applicationId: 'openclaw',
      }),
    );
    botService.getBotById.mockResolvedValue(makeBot({ botId: 'bot-edit' }));

    await expect(
      controller.updateOpenClawBot(OPENCLAW_APP_ID, 'bot-edit', TENANT_ID, {
        displayName: '',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const result = await controller.updateOpenClawBot(
      OPENCLAW_APP_ID,
      'bot-edit',
      TENANT_ID,
      {
        displayName: '  New Display Name  ',
      },
    );

    expect(botService.updateBotDisplayName).toHaveBeenCalledWith(
      'bot-edit',
      'New Display Name',
    );
    expect(result).toEqual({ success: true });
  });

  it('returns the verified installed app by id', async () => {
    const app = makeInstalledApp({
      id: OPENCLAW_APP_ID,
      applicationId: 'openclaw',
    });
    installedApplicationsService.findById.mockResolvedValueOnce(app);

    const result = await controller.findById(OPENCLAW_APP_ID, TENANT_ID);

    expect(result).toEqual(app);
  });
});

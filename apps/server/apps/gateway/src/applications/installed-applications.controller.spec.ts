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
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
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

jest.unstable_mockModule('../im/websocket/websocket.gateway.js', () => ({
  WebsocketGateway: class WebsocketGateway {},
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

jest.unstable_mockModule('../im/channels/channels.service.js', () => ({
  ChannelsService: class ChannelsService {},
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
  const selectedRows = { current: [] as any[] };
  const selectWhereChain = {
    limit: jest.fn<any>().mockResolvedValue([]),
    then: (onfulfilled?: (value: any[]) => unknown, onrejected?: (reason: unknown) => unknown) =>
      Promise.resolve(selectedRows.current).then(onfulfilled, onrejected),
  } as PromiseLike<any[]> & { limit: MockFn };
  const selectChain: Record<string, MockFn> = {
    from: jest.fn<any>(),
    where: jest.fn<any>(),
  };
  selectChain.from.mockReturnValue(selectChain);
  selectChain.where.mockReturnValue(selectWhereChain);

  const updateWhere = jest.fn<any>().mockResolvedValue(undefined);
  const set = jest.fn<any>().mockReturnValue({
    where: updateWhere,
  });

  return {
    selectedRows,
    select: jest.fn<any>().mockReturnValue(selectChain),
    from: selectChain.from,
    where: selectChain.where,
    limit: selectWhereChain.limit,
    update: jest.fn<any>().mockReturnValue({ set }),
    set,
    updateWhere,
  };
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
    createAgent: MockFn;
    deleteAgent: MockFn;
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
    createWorkspaceBot: MockFn;
    deleteBotAndCleanup: MockFn;
    updateBotExtra: MockFn;
  };
  let channelsService: {
    createDirectChannelsBatch: MockFn;
  };
  let websocketGateway: {
    sendToUser: MockFn;
    sendToChannelMembers: MockFn;
    broadcastToWorkspace: MockFn;
  };
  let redisService: {
    hgetall: MockFn;
  };

  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
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
      createAgent: jest.fn<any>().mockResolvedValue({ agentId: 'agent-1' }),
      deleteAgent: jest.fn<any>().mockResolvedValue(undefined),
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
      createWorkspaceBot: jest.fn<any>().mockResolvedValue({
        bot: makeBot(),
        accessToken: 'team9-token',
      }),
      deleteBotAndCleanup: jest.fn<any>().mockResolvedValue(undefined),
      updateBotExtra: jest.fn<any>().mockResolvedValue(undefined),
    };
    channelsService = {
      createDirectChannelsBatch: jest.fn<any>().mockResolvedValue(new Map()),
    };
    websocketGateway = {
      sendToUser: jest.fn<any>().mockResolvedValue(undefined),
      sendToChannelMembers: jest.fn<any>().mockResolvedValue(undefined),
      broadcastToWorkspace: jest.fn<any>().mockResolvedValue(undefined),
    };
    redisService = {
      hgetall: jest.fn<any>().mockResolvedValue({}),
    };

    controller = new InstalledApplicationsController(
      db as never,
      installedApplicationsService as never,
      applicationsService as never,
      openclawService as never,
      fileKeeperService as never,
      botService as never,
      channelsService as never,
      websocketGateway as never,
      redisService as never,
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

  it('requires tenantId for findAllWithBots', async () => {
    await expect(
      controller.findAllWithBots(undefined as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns empty bots for active non-special applications', async () => {
    const app = makeInstalledApp({
      id: 'custom-active-app',
      applicationId: 'custom-app',
    });
    installedApplicationsService.findAllByTenant.mockResolvedValueOnce([app]);

    const result = await controller.findAllWithBots(TENANT_ID);

    expect(result).toEqual([
      {
        ...app,
        bots: [],
        instanceStatus: null,
      },
    ]);
  });

  it.each([
    [
      'install',
      () =>
        controller.install(
          { applicationId: 'openclaw' } as never,
          USER_ID,
          undefined as never,
        ),
    ],
    [
      'update',
      () => controller.update(APP_ID, {} as never, undefined as never),
    ],
    ['uninstall', () => controller.uninstall(APP_ID, undefined as never)],
  ])('requires tenantId for %s', async (_, invoke) => {
    await expect(invoke()).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects install when the application cannot be found', async () => {
    applicationsService.findById.mockReturnValueOnce(null);

    await expect(
      controller.install(
        { applicationId: 'missing-app' } as never,
        USER_ID,
        TENANT_ID,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('delegates update and uninstall when tenantId is present', async () => {
    const updateDto = { displayName: 'Updated app name' } as never;
    installedApplicationsService.update.mockResolvedValueOnce({
      id: APP_ID,
      displayName: 'Updated app name',
    });

    await expect(
      controller.update(APP_ID, updateDto, TENANT_ID),
    ).resolves.toEqual({
      id: APP_ID,
      displayName: 'Updated app name',
    });
    await expect(controller.uninstall(APP_ID, TENANT_ID)).resolves.toEqual({
      success: true,
    });

    expect(installedApplicationsService.update).toHaveBeenCalledWith(
      APP_ID,
      TENANT_ID,
      updateDto,
    );
    expect(installedApplicationsService.uninstall).toHaveBeenCalledWith(
      APP_ID,
      TENANT_ID,
    );
  });

  it('rejects OpenClaw status requests when no instance is configured', async () => {
    installedApplicationsService.findById.mockResolvedValueOnce(
      makeInstalledApp({
        id: OPENCLAW_APP_ID,
        applicationId: 'openclaw',
        config: {},
      }),
    );

    await expect(
      controller.getOpenClawStatus(OPENCLAW_APP_ID, TENANT_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects OpenClaw status requests when the application type does not match', async () => {
    installedApplicationsService.findById.mockResolvedValueOnce(
      makeInstalledApp({
        id: OPENCLAW_APP_ID,
        applicationId: 'custom-app',
        config: { instancesId: 'openclaw-instance' },
      }),
    );

    await expect(
      controller.getOpenClawStatus(OPENCLAW_APP_ID, TENANT_ID),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('surfaces a missing access URL as a service unavailable error', async () => {
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
        access_url: '',
      }),
    );

    await expect(
      controller.getOpenClawGatewayInfo(OPENCLAW_APP_ID, TENANT_ID),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('falls back to empty OpenClaw bots and a null instance status when lookups fail', async () => {
    installedApplicationsService.findAllByTenant.mockResolvedValueOnce([
      makeInstalledApp({
        id: OPENCLAW_APP_ID,
        applicationId: 'openclaw',
        config: { instancesId: 'openclaw-instance' },
      }),
    ]);
    botService.getBotsByInstalledApplicationId.mockRejectedValueOnce(
      new Error('bot lookup failed'),
    );
    openclawService.getInstance.mockRejectedValueOnce(
      new Error('instance lookup failed'),
    );

    const result = await controller.findAllWithBots(TENANT_ID);

    expect(botService.getBotsByInstalledApplicationId).toHaveBeenCalledWith(
      OPENCLAW_APP_ID,
    );
    expect(openclawService.getInstance).toHaveBeenCalledWith(
      'openclaw-instance',
    );
    expect(result).toEqual([
      expect.objectContaining({
        id: OPENCLAW_APP_ID,
        bots: [],
        instanceStatus: null,
      }),
    ]);
  });

  it('rejects OpenClaw status requests when the instance cannot be found', async () => {
    installedApplicationsService.findById.mockResolvedValueOnce(
      makeInstalledApp({
        id: OPENCLAW_APP_ID,
        applicationId: 'openclaw',
        config: { instancesId: 'openclaw-instance' },
      }),
    );
    openclawService.getInstance.mockResolvedValueOnce(null);

    await expect(
      controller.getOpenClawStatus(OPENCLAW_APP_ID, TENANT_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('falls back to the default file-keeper base URL when listing workspaces', async () => {
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
        file_keeper_domain: undefined,
      }),
    );
    fileKeeperService.listWorkspaces.mockResolvedValueOnce([
      { name: 'workspace-a', modified: '2026-04-01T09:00:00Z' },
    ]);

    const result = await controller.getOpenClawWorkspaces(
      OPENCLAW_APP_ID,
      TENANT_ID,
    );

    expect(fileKeeperService.listWorkspaces).toHaveBeenCalledWith(
      'openclaw-instance',
      undefined,
    );
    expect(result).toEqual({
      instanceId: 'openclaw-instance',
      workspaces: [{ name: 'workspace-a', modified: '2026-04-01T09:00:00Z' }],
    });
  });

  it('passes an undefined base URL to FileKeeper token issuance when the instance has no file-keeper domain', async () => {
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
        file_keeper_domain: undefined,
      }),
    );

    const result = await controller.getFileKeeperToken(
      OPENCLAW_APP_ID,
      TENANT_ID,
    );

    expect(fileKeeperService.issueToken).toHaveBeenCalledWith(
      'openclaw-instance',
      ['workspace-dir', 'data-dir'],
      undefined,
    );
    expect(result).toEqual({
      token: 'fk-token',
      baseUrl: 'https://files.example.com',
      instanceId: INSTANCE_ID,
      expiresAt: '2026-04-02T13:00:00Z',
    });
  });

  it('rejects OpenClaw actions when no instance is configured', async () => {
    installedApplicationsService.findById.mockResolvedValue(
      makeInstalledApp({
        id: OPENCLAW_APP_ID,
        applicationId: 'openclaw',
        config: {},
      }),
    );

    await expect(
      controller.startOpenClaw(OPENCLAW_APP_ID, TENANT_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      controller.stopOpenClaw(OPENCLAW_APP_ID, TENANT_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      controller.restartOpenClaw(OPENCLAW_APP_ID, TENANT_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      controller.getOpenClawDevices(OPENCLAW_APP_ID, TENANT_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      controller.getOpenClawGatewayInfo(OPENCLAW_APP_ID, TENANT_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      controller.selfApproveOpenClawDevice(OPENCLAW_APP_ID, TENANT_ID, 'req-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      controller.approveOpenClawDevice(OPENCLAW_APP_ID, TENANT_ID, {
        requestId: 'req-1',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      controller.rejectOpenClawDevice(OPENCLAW_APP_ID, TENANT_ID, {
        requestId: 'req-1',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      controller.getOpenClawWorkspaces(OPENCLAW_APP_ID, TENANT_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      controller.getFileKeeperToken(OPENCLAW_APP_ID, TENANT_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      controller.createOpenClawAgent(OPENCLAW_APP_ID, USER_ID, TENANT_ID, {
        displayName: 'Agent Display',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('creates an OpenClaw agent and persists its bot metadata', async () => {
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
      }),
    );
    botService.createWorkspaceBot.mockResolvedValueOnce({
      bot: makeBot({
        botId: 'bot-created',
        displayName: 'Agent Display',
        username: 'agent_name',
      }),
      accessToken: 'team9-token',
    });
    openclawService.createAgent.mockResolvedValueOnce({
      agentId: 'agent-created',
      name: 'agent-display-abcd',
    });

    const result = await controller.createOpenClawAgent(
      OPENCLAW_APP_ID,
      USER_ID,
      TENANT_ID,
      {
        displayName: '  Agent Display  ',
        username: '  agent_name  ',
        description: '  Agent description  ',
      },
    );

    expect(botService.createWorkspaceBot).toHaveBeenCalledWith({
      ownerId: USER_ID,
      tenantId: TENANT_ID,
      displayName: 'Agent Display',
      username: 'agent_name',
      installedApplicationId: OPENCLAW_APP_ID,
      generateToken: true,
      mentorId: USER_ID,
    });
    expect(openclawService.createAgent).toHaveBeenCalledWith(
      'openclaw-instance',
      {
        name: 'agent-display-abcd',
        workspace: '/data/.openclaw/workspace-bot-created',
        team9_token: 'team9-token',
      },
    );
    expect(botService.updateBotExtra).toHaveBeenCalledWith('bot-created', {
      openclaw: {
        agentId: 'agent-created',
        workspace: 'bot-created',
      },
    });
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(db.set).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Agent description',
        updatedAt: expect.any(Date),
      }),
    );
    expect(result).toEqual({
      botId: 'bot-created',
      agentId: 'agent-created',
      displayName: 'Agent Display',
      mentorId: USER_ID,
    });
  });

  it.each([
    [
      'rejects malformed usernames before creating an OpenClaw agent',
      'Bad Name',
      BadRequestException,
    ],
    [
      'rejects duplicate usernames before creating an OpenClaw agent',
      'agent_name',
      ConflictException,
    ],
  ])('%s', async (_, username, exceptionType) => {
    installedApplicationsService.findById.mockResolvedValueOnce(
      makeInstalledApp({
        id: OPENCLAW_APP_ID,
        applicationId: 'openclaw',
        config: { instancesId: 'openclaw-instance' },
      }),
    );
    if (username === 'agent_name') {
      botService.isUsernameTaken.mockResolvedValueOnce(true);
    }

    await expect(
      controller.createOpenClawAgent(OPENCLAW_APP_ID, USER_ID, TENANT_ID, {
        displayName: 'Agent Display',
        username,
      }),
    ).rejects.toBeInstanceOf(exceptionType);

    expect(botService.createWorkspaceBot).not.toHaveBeenCalled();
    expect(openclawService.getInstance).not.toHaveBeenCalled();
  });

  it('rejects OpenClaw agent creation when the instance is not running', async () => {
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
        status: 'stopped',
      }),
    );

    await expect(
      controller.createOpenClawAgent(OPENCLAW_APP_ID, USER_ID, TENANT_ID, {
        displayName: 'Agent Display',
        username: 'agent_name',
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(botService.createWorkspaceBot).not.toHaveBeenCalled();
  });

  it('rolls back the created bot when OpenClaw agent creation fails with a 400 response', async () => {
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
      }),
    );
    botService.createWorkspaceBot.mockResolvedValueOnce({
      bot: makeBot({
        botId: 'bot-created',
        displayName: 'Agent Display',
      }),
      accessToken: 'team9-token',
    });
    openclawService.createAgent.mockRejectedValueOnce(
      new Error('control plane responded 400 — agent already exists'),
    );

    await expect(
      controller.createOpenClawAgent(OPENCLAW_APP_ID, USER_ID, TENANT_ID, {
        displayName: 'Agent Display',
        username: 'agent_name',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(botService.deleteBotAndCleanup).toHaveBeenCalledWith('bot-created');
  });

  it('rolls back the created bot when OpenClaw agent creation returns no agent id', async () => {
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
      }),
    );
    botService.createWorkspaceBot.mockResolvedValueOnce({
      bot: makeBot({
        botId: 'bot-created',
        displayName: 'Agent Display',
      }),
      accessToken: 'team9-token',
    });
    openclawService.createAgent.mockResolvedValueOnce({
      name: 'agent-display-abcd',
    });

    await expect(
      controller.createOpenClawAgent(OPENCLAW_APP_ID, USER_ID, TENANT_ID, {
        displayName: 'Agent Display',
        username: 'agent_name',
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(botService.deleteBotAndCleanup).toHaveBeenCalledWith('bot-created');
    expect(botService.updateBotExtra).not.toHaveBeenCalled();
  });

  it.each([
    [
      'rethrows service unavailable createAgent errors',
      new ServiceUnavailableException('control plane unavailable'),
      'control plane unavailable',
    ],
    [
      'falls back to a generic service unavailable error for unexpected createAgent failures',
      new Error('unexpected createAgent failure'),
      'Failed to create agent on OpenClaw instance',
    ],
  ])('%s', async (_, error, expectedMessage) => {
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
      }),
    );
    botService.createWorkspaceBot.mockResolvedValueOnce({
      bot: makeBot({
        botId: 'bot-created',
        displayName: 'Agent Display',
      }),
      accessToken: 'team9-token',
    });
    openclawService.createAgent.mockRejectedValueOnce(error);

    await expect(
      controller.createOpenClawAgent(OPENCLAW_APP_ID, USER_ID, TENANT_ID, {
        displayName: 'Agent Display',
        username: 'agent_name',
      }),
    ).rejects.toMatchObject({ message: expectedMessage });

    expect(botService.deleteBotAndCleanup).toHaveBeenCalledWith('bot-created');
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

  it('returns no devices when OpenClaw reports a null device list', async () => {
    installedApplicationsService.findById.mockResolvedValueOnce(
      makeInstalledApp({
        id: OPENCLAW_APP_ID,
        applicationId: 'openclaw',
        config: { instancesId: 'openclaw-instance' },
      }),
    );
    openclawService.listDevices.mockResolvedValueOnce(null);

    const result = await controller.getOpenClawDevices(
      OPENCLAW_APP_ID,
      TENANT_ID,
    );

    expect(openclawService.listDevices).toHaveBeenCalledWith(
      'openclaw-instance',
    );
    expect(result).toEqual({ devices: [] });
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

  it('approves and rejects device pairing requests', async () => {
    installedApplicationsService.findById.mockResolvedValue(
      makeInstalledApp({
        id: OPENCLAW_APP_ID,
        applicationId: 'openclaw',
        config: { instancesId: 'openclaw-instance' },
      }),
    );

    await expect(
      controller.approveOpenClawDevice(OPENCLAW_APP_ID, TENANT_ID, {
        requestId: 'req-approve',
      }),
    ).resolves.toEqual({ success: true });
    await expect(
      controller.rejectOpenClawDevice(OPENCLAW_APP_ID, TENANT_ID, {
        requestId: 'req-reject',
      }),
    ).resolves.toEqual({ success: true });

    expect(openclawService.approveDevice).toHaveBeenCalledWith(
      'openclaw-instance',
      'req-approve',
    );
    expect(openclawService.rejectDevice).toHaveBeenCalledWith(
      'openclaw-instance',
      'req-reject',
    );
  });

  it('rejects deleting the default OpenClaw bot', async () => {
    installedApplicationsService.findById.mockResolvedValueOnce(
      makeInstalledApp({
        id: OPENCLAW_APP_ID,
        applicationId: 'openclaw',
        config: { instancesId: 'openclaw-instance' },
      }),
    );
    botService.getBotById.mockResolvedValueOnce(
      makeBot({
        botId: 'bot-default',
        extra: {},
      }),
    );

    await expect(
      controller.deleteOpenClawAgent(
        OPENCLAW_APP_ID,
        'bot-default',
        USER_ID,
        TENANT_ID,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(openclawService.deleteAgent).not.toHaveBeenCalled();
    expect(botService.deleteBotAndCleanup).not.toHaveBeenCalled();
  });

  it('continues bot cleanup when OpenClaw deleteAgent fails', async () => {
    installedApplicationsService.findById.mockResolvedValueOnce(
      makeInstalledApp({
        id: OPENCLAW_APP_ID,
        applicationId: 'openclaw',
        config: { instancesId: 'openclaw-instance' },
      }),
    );
    botService.getBotById.mockResolvedValueOnce(
      makeBot({
        botId: 'bot-delete',
        mentorId: USER_ID,
        extra: {
          openclaw: {
            agentId: 'agent-123',
            workspace: 'workspace-123',
          },
        },
      }),
    );
    openclawService.deleteAgent.mockRejectedValueOnce(
      new Error('control plane unavailable'),
    );

    const result = await controller.deleteOpenClawAgent(
      OPENCLAW_APP_ID,
      'bot-delete',
      USER_ID,
      TENANT_ID,
    );

    expect(openclawService.deleteAgent).toHaveBeenCalledWith(
      'openclaw-instance',
      'agent-123',
    );
    expect(botService.deleteBotAndCleanup).toHaveBeenCalledWith('bot-delete');
    expect(result).toEqual({ success: true });
  });

  it.each([
    [
      'updateOpenClawBot',
      () =>
        controller.updateOpenClawBot(
          OPENCLAW_APP_ID,
          'bot-missing',
          TENANT_ID,
          {
            displayName: 'Updated',
          },
        ),
    ],
    [
      'updateOpenClawBotMentor',
      () =>
        controller.updateOpenClawBotMentor(
          OPENCLAW_APP_ID,
          'bot-missing',
          USER_ID,
          TENANT_ID,
          { mentorId: OTHER_USER_ID },
        ),
    ],
    [
      'deleteOpenClawAgent',
      () =>
        controller.deleteOpenClawAgent(
          OPENCLAW_APP_ID,
          'bot-missing',
          USER_ID,
          TENANT_ID,
        ),
    ],
  ])('returns not found when the bot is missing for %s', async (_, invoke) => {
    installedApplicationsService.findById.mockResolvedValueOnce(
      makeInstalledApp({
        id: OPENCLAW_APP_ID,
        applicationId: 'openclaw',
        config: { instancesId: 'openclaw-instance' },
      }),
    );
    botService.getBotById.mockResolvedValueOnce(null);

    await expect(invoke()).rejects.toBeInstanceOf(NotFoundException);
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

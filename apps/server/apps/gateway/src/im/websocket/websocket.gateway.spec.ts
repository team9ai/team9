import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

process.env.CORS_ORIGIN = 'http://localhost:3000';

const metricFns = {
  wsConnectionsAdd: jest.fn(),
  onlineUsersAdd: jest.fn(),
  messagesTotalAdd: jest.fn(),
};

jest.unstable_mockModule('@team9/observability', () => ({
  appMetrics: {
    wsConnections: { add: metricFns.wsConnectionsAdd },
    onlineUsers: { add: metricFns.onlineUsersAdd },
    messagesTotal: { add: metricFns.messagesTotalAdd },
  },
}));

// Break circular import: websocket.gateway -> messages.service -> message-properties.service -> websocket.gateway
jest.unstable_mockModule('../properties/message-properties.service.js', () => ({
  MessagePropertiesService: jest.fn(),
}));

const { WebsocketGateway } = await import('./websocket.gateway.js');
const { WS_EVENTS } = await import('./events/events.constants.js');
const { REDIS_KEYS } = await import('../shared/constants/redis-keys.js');

function makeServer() {
  const emits: Array<{ room: string; event: string; data: unknown }> = [];
  const server = {
    adapter: jest.fn<any>(),
    to: jest.fn<any>((room: string) => ({
      emit: jest.fn<any>((event: string, data: unknown) => {
        emits.push({ room, event, data });
      }),
    })),
  };
  return { server, emits };
}

function makeClient(overrides: Record<string, unknown> = {}) {
  const listeners = new Map<string, (...args: any[]) => void>();
  const client: Record<string, any> = {
    id: 'socket-1',
    handshake: {
      auth: {},
      headers: {},
    },
    emit: jest.fn<any>(),
    disconnect: jest.fn<any>(),
    join: jest.fn<any>().mockResolvedValue(undefined),
    leave: jest.fn<any>().mockResolvedValue(undefined),
    on: jest.fn<any>((event: string, cb: (...args: any[]) => void) => {
      listeners.set(event, cb);
      return client;
    }),
    ...overrides,
  };
  return { client, listeners };
}

function createDeps() {
  const authService = {
    verifyToken: jest.fn<any>(),
  };
  const usersService = {
    setOnline: jest.fn<any>().mockResolvedValue(undefined),
    setOffline: jest.fn<any>().mockResolvedValue(undefined),
  };
  const channelsService = {
    assertReadAccess: jest.fn<any>().mockResolvedValue(undefined),
    isMember: jest.fn<any>().mockResolvedValue(true),
    findById: jest.fn<any>().mockResolvedValue({
      id: 'channel-1',
      tenantId: 'tenant-1',
    }),
    isUserInTenant: jest.fn<any>().mockResolvedValue(true),
  };
  const messagesService = {
    markAsRead: jest.fn<any>().mockResolvedValue(undefined),
    addReaction: jest.fn<any>().mockResolvedValue(undefined),
    removeReaction: jest.fn<any>().mockResolvedValue(undefined),
    getMessageChannelId: jest.fn<any>().mockResolvedValue('channel-1'),
    truncateForPreview: jest.fn<any>().mockImplementation((msg) => msg),
  };
  const redisService = {
    set: jest.fn<any>().mockResolvedValue(undefined),
    del: jest.fn<any>().mockResolvedValue(undefined),
    expire: jest.fn<any>().mockResolvedValue(undefined),
    sadd: jest.fn<any>().mockResolvedValue(undefined),
    srem: jest.fn<any>().mockResolvedValue(undefined),
    smembers: jest.fn<any>().mockResolvedValue([]),
    get: jest.fn<any>().mockResolvedValue(null),
  };
  const workspaceService = {
    isWorkspaceMember: jest.fn<any>().mockResolvedValue(true),
    getWorkspaceMembers: jest.fn<any>().mockResolvedValue([]),
    getWorkspaceIdsByUserId: jest.fn<any>().mockResolvedValue(['workspace-1']),
  };
  const channelMemberCacheService = {
    getMemberIds: jest.fn<any>().mockResolvedValue(['user-1', 'user-2']),
  };
  const clusterNodeService = {
    getNodeId: jest.fn<any>().mockReturnValue('gateway-1'),
    incrementConnections: jest.fn<any>(),
    decrementConnections: jest.fn<any>(),
  };
  const sessionService = {
    addDeviceSession: jest.fn<any>().mockResolvedValue(undefined),
    removeDeviceSession: jest.fn<any>().mockResolvedValue(undefined),
    hasActiveDeviceSessions: jest.fn<any>().mockResolvedValue(false),
  };
  const heartbeatService = {
    handlePing: jest.fn<any>().mockResolvedValue({
      type: 'pong',
      timestamp: 123,
      serverTime: 456,
    }),
  };
  const zombieCleanerService = {
    setServer: jest.fn<any>(),
  };
  const connectionService = {
    setServer: jest.fn<any>(),
    registerConnection: jest.fn<any>(),
    unregisterConnection: jest.fn<any>(),
  };
  const gatewayMQService = {
    publishUpstream: jest.fn<any>().mockResolvedValue(undefined),
    initializeForNode: jest.fn<any>().mockResolvedValue(undefined),
  };
  const socketRedisAdapterService = {
    isInitialized: jest.fn<any>().mockReturnValue(false),
    getAdapter: jest.fn<any>().mockReturnValue('redis-adapter'),
  };
  const botTokenValidator = {
    validateBotToken: jest.fn<any>().mockResolvedValue(null),
  };

  return {
    authService,
    usersService,
    channelsService,
    messagesService,
    redisService,
    workspaceService,
    channelMemberCacheService,
    clusterNodeService,
    sessionService,
    heartbeatService,
    zombieCleanerService,
    connectionService,
    gatewayMQService,
    socketRedisAdapterService,
    botTokenValidator,
  };
}

function createGateway(overrides: Partial<ReturnType<typeof createDeps>> = {}) {
  const deps = {
    ...createDeps(),
    ...overrides,
  };
  const gateway = new WebsocketGateway(
    deps.authService as never,
    deps.usersService as never,
    deps.channelsService as never,
    deps.messagesService as never,
    deps.redisService as never,
    deps.workspaceService as never,
    deps.channelMemberCacheService as never,
    deps.clusterNodeService as never,
    deps.sessionService as never,
    deps.heartbeatService as never,
    deps.zombieCleanerService as never,
    deps.connectionService as never,
    deps.gatewayMQService as never,
    deps.socketRedisAdapterService as never,
    deps.botTokenValidator as never,
  );
  const { server, emits } = makeServer();
  gateway.server = server as never;
  return { gateway, deps, server, emits };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('WebsocketGateway', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('afterInit', () => {
    it('wires adapter and optional services when distributed services are available', async () => {
      const { gateway, deps, server } = createGateway();
      deps.socketRedisAdapterService.isInitialized.mockReturnValue(true);

      gateway.afterInit(server as never);

      expect(server.adapter).toHaveBeenCalledWith('redis-adapter');
      expect(deps.zombieCleanerService.setServer).toHaveBeenCalledWith(server);
      expect(deps.connectionService.setServer).toHaveBeenCalledWith(server);
      expect(deps.gatewayMQService.initializeForNode).toHaveBeenCalledWith(
        'gateway-1',
      );
    });

    it('logs adapter setup failures without aborting the rest of initialization', () => {
      const { gateway, deps, server } = createGateway();
      const loggerError = jest
        .spyOn((gateway as any).logger, 'error')
        .mockImplementation(() => undefined);
      deps.socketRedisAdapterService.isInitialized.mockReturnValue(true);
      server.adapter.mockImplementationOnce(() => {
        throw new Error('adapter boom');
      });

      gateway.afterInit(server as never);

      expect(loggerError).toHaveBeenCalledWith(
        'Failed to configure Socket.io Redis Adapter',
        expect.any(Error),
      );
      expect(deps.zombieCleanerService.setServer).toHaveBeenCalledWith(server);
      expect(deps.connectionService.setServer).toHaveBeenCalledWith(server);
    });

    it('logs gateway MQ initialization failures from the async catch handler', async () => {
      const { gateway, deps, server } = createGateway();
      const loggerError = jest
        .spyOn((gateway as any).logger, 'error')
        .mockImplementation(() => undefined);
      deps.gatewayMQService.initializeForNode.mockRejectedValueOnce(
        new Error('mq init boom'),
      );

      gateway.afterInit(server as never);
      await flushMicrotasks();

      expect(loggerError).toHaveBeenCalledWith(
        expect.stringContaining('Failed to initialize Gateway MQ:'),
      );
    });
  });

  describe('handleConnection', () => {
    it('rejects connections without any token', async () => {
      const { gateway } = createGateway();
      const { client } = makeClient();

      await gateway.handleConnection(client as never);

      expect(client.emit).toHaveBeenCalledWith(WS_EVENTS.AUTH.AUTH_ERROR, {
        message: 'No token provided',
      });
      expect(client.disconnect).toHaveBeenCalled();
    });

    it('rejects bot connections when bot authentication is unavailable', async () => {
      const { gateway } = createGateway({
        botTokenValidator: undefined,
      });
      const { client } = makeClient({
        handshake: {
          auth: { token: 't9bot_token' },
          headers: {},
        },
      });

      await gateway.handleConnection(client as never);

      expect(client.emit).toHaveBeenCalledWith(WS_EVENTS.AUTH.AUTH_ERROR, {
        message: 'Bot authentication not available',
      });
      expect(client.disconnect).toHaveBeenCalled();
    });

    it('rejects invalid bot tokens', async () => {
      const { gateway, deps } = createGateway();
      const { client } = makeClient({
        handshake: {
          auth: { token: 't9bot_token' },
          headers: {},
        },
      });
      deps.botTokenValidator.validateBotToken.mockResolvedValueOnce(null);

      await gateway.handleConnection(client as never);

      expect(client.emit).toHaveBeenCalledWith(WS_EVENTS.AUTH.AUTH_ERROR, {
        message: 'Invalid bot token',
      });
      expect(client.disconnect).toHaveBeenCalled();
    });

    it('authenticates normal users, joins rooms, updates presence, and notifies upstream', async () => {
      const { gateway, deps, emits } = createGateway();
      const { client } = makeClient({
        handshake: {
          auth: {
            token: 'jwt-token',
            platform: 'ios',
            version: '1.2.3',
            deviceId: 'device-1',
          },
          headers: {},
        },
      });
      deps.authService.verifyToken.mockReturnValueOnce({
        sub: 'user-1',
        username: 'alice',
      });
      deps.workspaceService.getWorkspaceIdsByUserId.mockResolvedValueOnce([
        'workspace-1',
        'workspace-2',
      ]);

      await gateway.handleConnection(client as never);

      expect(client.userId).toBe('user-1');
      expect(client.username).toBe('alice');
      expect(client.isBot).toBe(false);
      expect(deps.redisService.set).toHaveBeenCalledWith(
        REDIS_KEYS.SOCKET_USER('socket-1'),
        'user-1',
        300,
      );
      expect(deps.redisService.sadd).toHaveBeenCalledWith(
        REDIS_KEYS.USER_SOCKETS('user-1'),
        'socket-1',
      );
      expect(deps.redisService.expire).toHaveBeenCalledWith(
        REDIS_KEYS.USER_SOCKETS('user-1'),
        300,
      );
      expect(deps.sessionService.addDeviceSession).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          socketId: 'socket-1',
          gatewayId: 'gateway-1',
          deviceInfo: {
            platform: 'ios',
            version: '1.2.3',
            deviceId: 'device-1',
          },
        }),
      );
      expect(deps.clusterNodeService.incrementConnections).toHaveBeenCalled();
      expect(deps.connectionService.registerConnection).toHaveBeenCalledWith(
        'socket-1',
        'user-1',
      );
      expect(deps.usersService.setOnline).toHaveBeenCalledWith('user-1');
      expect(client.join).toHaveBeenCalledWith('user:user-1');
      expect(client.join).toHaveBeenCalledWith('workspace:workspace-1');
      expect(client.join).toHaveBeenCalledWith('workspace:workspace-2');
      expect(deps.gatewayMQService.publishUpstream).toHaveBeenCalledWith(
        expect.objectContaining({
          gatewayId: 'gateway-1',
          userId: 'user-1',
        }),
      );
      expect(metricFns.wsConnectionsAdd).toHaveBeenCalledWith(1);
      expect(metricFns.onlineUsersAdd).toHaveBeenCalledWith(1);
      expect(client.emit).toHaveBeenCalledWith(WS_EVENTS.AUTH.AUTHENTICATED, {
        userId: 'user-1',
      });
      expect(emits).toEqual([
        {
          room: 'workspace:workspace-1',
          event: WS_EVENTS.USER.ONLINE,
          data: {
            userId: 'user-1',
            username: 'alice',
            workspaceId: 'workspace-1',
          },
        },
        {
          room: 'workspace:workspace-2',
          event: WS_EVENTS.USER.ONLINE,
          data: {
            userId: 'user-1',
            username: 'alice',
            workspaceId: 'workspace-2',
          },
        },
      ]);
    });

    it('authenticates bot users through the bot token validator', async () => {
      const { gateway, deps } = createGateway();
      const { client } = makeClient({
        handshake: {
          auth: { token: 't9bot_token' },
          headers: {},
        },
      });
      deps.botTokenValidator.validateBotToken.mockResolvedValueOnce({
        sub: 'bot-1',
        username: 'helper-bot',
      });
      deps.workspaceService.getWorkspaceIdsByUserId.mockResolvedValueOnce([]);

      await gateway.handleConnection(client as never);

      expect(client.userId).toBe('bot-1');
      expect(client.isBot).toBe(true);
      expect(deps.authService.verifyToken).not.toHaveBeenCalled();
      expect(deps.gatewayMQService.publishUpstream).not.toHaveBeenCalled();
      expect(client.emit).toHaveBeenCalledWith(WS_EVENTS.AUTH.AUTHENTICATED, {
        userId: 'bot-1',
      });
    });

    it('falls back to a generic auth error when verification throws', async () => {
      const { gateway, deps } = createGateway();
      const { client } = makeClient({
        handshake: {
          auth: { token: 'jwt-token' },
          headers: {},
        },
      });
      deps.authService.verifyToken.mockImplementationOnce(() => {
        throw new Error('bad token');
      });

      await gateway.handleConnection(client as never);

      expect(client.emit).toHaveBeenCalledWith(WS_EVENTS.AUTH.AUTH_ERROR, {
        message: 'Authentication failed',
      });
      expect(client.disconnect).toHaveBeenCalled();
    });

    it('accepts bearer tokens from headers and skips optional distributed services when absent', async () => {
      const { gateway, deps } = createGateway({
        sessionService: undefined,
        clusterNodeService: undefined,
        connectionService: undefined,
        gatewayMQService: undefined,
      });
      const { client } = makeClient({
        handshake: {
          auth: {},
          headers: { authorization: 'Bearer jwt-from-header' },
        },
      });
      deps.authService.verifyToken.mockReturnValueOnce({
        sub: 'user-2',
        username: 'bob',
      });
      deps.workspaceService.getWorkspaceIdsByUserId.mockResolvedValueOnce([
        'workspace-9',
      ]);

      await gateway.handleConnection(client as never);

      expect(deps.authService.verifyToken).toHaveBeenCalledWith(
        'jwt-from-header',
      );
      expect(deps.usersService.setOnline).toHaveBeenCalledWith('user-2');
      expect(client.join).toHaveBeenCalledWith('user:user-2');
      expect(client.join).toHaveBeenCalledWith('workspace:workspace-9');
      expect(client.emit).toHaveBeenCalledWith(WS_EVENTS.AUTH.AUTHENTICATED, {
        userId: 'user-2',
      });
    });

    it('surfaces a generic auth error when setOnline fails after authentication', async () => {
      const { gateway, deps } = createGateway();
      const { client } = makeClient({
        handshake: {
          auth: { token: 'jwt-token' },
          headers: {},
        },
      });
      deps.authService.verifyToken.mockReturnValueOnce({
        sub: 'user-1',
        username: 'alice',
      });
      deps.usersService.setOnline.mockRejectedValueOnce(
        new Error('redis down'),
      );

      await gateway.handleConnection(client as never);

      expect(deps.usersService.setOnline).toHaveBeenCalledWith('user-1');
      expect(client.emit).toHaveBeenCalledWith(WS_EVENTS.AUTH.AUTH_ERROR, {
        message: 'Authentication failed',
      });
      expect(client.disconnect).toHaveBeenCalled();
      expect(client.emit).not.toHaveBeenCalledWith(
        WS_EVENTS.AUTH.AUTHENTICATED,
        expect.anything(),
      );
    });

    it('warns but still authenticates when the upstream online notification fails', async () => {
      const { gateway, deps } = createGateway();
      const loggerWarn = jest
        .spyOn((gateway as any).logger, 'warn')
        .mockImplementation(() => undefined);
      const { client } = makeClient({
        handshake: {
          auth: { token: 'jwt-token' },
          headers: {},
        },
      });
      deps.authService.verifyToken.mockReturnValueOnce({
        sub: 'user-1',
        username: 'alice',
      });
      deps.gatewayMQService.publishUpstream.mockRejectedValueOnce(
        new Error('mq down'),
      );

      await gateway.handleConnection(client as never);

      expect(loggerWarn).toHaveBeenCalledWith(
        expect.stringContaining(
          'Failed to notify IM Worker service of user online:',
        ),
      );
      expect(client.emit).toHaveBeenCalledWith(WS_EVENTS.AUTH.AUTHENTICATED, {
        userId: 'user-1',
      });
      expect(client.disconnect).not.toHaveBeenCalled();
    });
  });

  describe('handleDisconnect', () => {
    it('no-ops when the socket was never authenticated', async () => {
      const { gateway, deps } = createGateway();
      const { client } = makeClient();

      await gateway.handleDisconnect(client as never);

      expect(metricFns.wsConnectionsAdd).not.toHaveBeenCalledWith(-1);
      expect(deps.redisService.del).not.toHaveBeenCalled();
    });

    it('cleans up a normal user with no remaining sessions and broadcasts offline', async () => {
      const { gateway, deps, emits } = createGateway();
      const { client } = makeClient({
        userId: 'user-1',
        isBot: false,
      });
      deps.workspaceService.getWorkspaceIdsByUserId.mockResolvedValueOnce([
        'workspace-1',
        'workspace-2',
      ]);

      await gateway.handleDisconnect(client as never);

      expect(metricFns.wsConnectionsAdd).toHaveBeenCalledWith(-1);
      expect(metricFns.onlineUsersAdd).toHaveBeenCalledWith(-1);
      expect(deps.redisService.del).toHaveBeenCalledWith(
        REDIS_KEYS.SOCKET_USER('socket-1'),
      );
      expect(deps.redisService.srem).toHaveBeenCalledWith(
        REDIS_KEYS.USER_SOCKETS('user-1'),
        'socket-1',
      );
      expect(deps.sessionService.removeDeviceSession).toHaveBeenCalledWith(
        'user-1',
        'socket-1',
      );
      expect(deps.connectionService.unregisterConnection).toHaveBeenCalledWith(
        'socket-1',
      );
      expect(deps.clusterNodeService.decrementConnections).toHaveBeenCalled();
      expect(deps.usersService.setOffline).toHaveBeenCalledWith('user-1');
      expect(deps.gatewayMQService.publishUpstream).toHaveBeenCalledWith(
        expect.objectContaining({
          gatewayId: 'gateway-1',
          userId: 'user-1',
        }),
      );
      expect(emits).toEqual([
        {
          room: 'workspace:workspace-1',
          event: WS_EVENTS.USER.OFFLINE,
          data: {
            userId: 'user-1',
            workspaceId: 'workspace-1',
          },
        },
        {
          room: 'workspace:workspace-2',
          event: WS_EVENTS.USER.OFFLINE,
          data: {
            userId: 'user-1',
            workspaceId: 'workspace-2',
          },
        },
      ]);
    });

    it('keeps normal users online when another active device session exists', async () => {
      const { gateway, deps } = createGateway();
      const { client } = makeClient({
        userId: 'user-1',
        isBot: false,
      });
      deps.sessionService.hasActiveDeviceSessions.mockResolvedValueOnce(true);

      await gateway.handleDisconnect(client as never);

      expect(metricFns.onlineUsersAdd).not.toHaveBeenCalledWith(-1);
      expect(deps.usersService.setOffline).not.toHaveBeenCalled();
      expect(deps.gatewayMQService.publishUpstream).not.toHaveBeenCalled();
    });

    it('falls back to the legacy socket set when sessionService is unavailable', async () => {
      const { gateway, deps } = createGateway({
        sessionService: undefined,
      });
      const { client } = makeClient({
        userId: 'user-1',
        isBot: false,
      });
      deps.redisService.smembers.mockResolvedValueOnce(['socket-2']);

      await gateway.handleDisconnect(client as never);

      expect(deps.redisService.smembers).toHaveBeenCalledWith(
        REDIS_KEYS.USER_SOCKETS('user-1'),
      );
      expect(deps.usersService.setOffline).not.toHaveBeenCalled();
    });

    it('cleans up bot streams and broadcasts offline when a bot loses its final session', async () => {
      const { gateway, deps, emits } = createGateway();
      const cleanupSpy = jest
        .spyOn(gateway as any, 'cleanupBotStreams')
        .mockResolvedValue(undefined);
      const { client } = makeClient({
        userId: 'bot-1',
        isBot: true,
      });
      deps.workspaceService.getWorkspaceIdsByUserId.mockResolvedValueOnce([
        'workspace-1',
      ]);

      await gateway.handleDisconnect(client as never);

      expect(cleanupSpy).toHaveBeenCalledWith('bot-1');
      expect(deps.usersService.setOffline).toHaveBeenCalledWith('bot-1');
      expect(deps.gatewayMQService.publishUpstream).not.toHaveBeenCalled();
      expect(emits).toEqual([
        {
          room: 'workspace:workspace-1',
          event: WS_EVENTS.USER.OFFLINE,
          data: {
            userId: 'bot-1',
            workspaceId: 'workspace-1',
          },
        },
      ]);
    });

    it('keeps bots online when another device session still exists', async () => {
      const { gateway, deps } = createGateway();
      const cleanupSpy = jest
        .spyOn(gateway as any, 'cleanupBotStreams')
        .mockResolvedValue(undefined);
      const { client } = makeClient({
        userId: 'bot-1',
        isBot: true,
      });
      deps.sessionService.hasActiveDeviceSessions.mockResolvedValueOnce(true);

      await gateway.handleDisconnect(client as never);

      expect(metricFns.onlineUsersAdd).not.toHaveBeenCalledWith(-1);
      expect(cleanupSpy).not.toHaveBeenCalled();
      expect(deps.usersService.setOffline).not.toHaveBeenCalled();
    });

    it('warns but still disconnects cleanly when the upstream offline publish fails', async () => {
      const { gateway, deps, emits } = createGateway();
      const loggerWarn = jest
        .spyOn((gateway as any).logger, 'warn')
        .mockImplementation(() => undefined);
      const { client } = makeClient({
        userId: 'user-1',
        isBot: false,
      });
      deps.workspaceService.getWorkspaceIdsByUserId.mockResolvedValueOnce([
        'workspace-1',
      ]);
      deps.gatewayMQService.publishUpstream.mockRejectedValueOnce(
        new Error('offline mq down'),
      );

      await gateway.handleDisconnect(client as never);

      expect(deps.usersService.setOffline).toHaveBeenCalledWith('user-1');
      expect(loggerWarn).toHaveBeenCalledWith(
        expect.stringContaining(
          'Failed to notify IM Worker service of user offline:',
        ),
      );
      expect(emits).toContainEqual({
        room: 'workspace:workspace-1',
        event: WS_EVENTS.USER.OFFLINE,
        data: {
          userId: 'user-1',
          workspaceId: 'workspace-1',
        },
      });
    });
  });

  describe('simple channel handlers', () => {
    it('returns success for deprecated join/leave handlers', () => {
      const { gateway } = createGateway();
      const { client } = makeClient({ userId: 'user-1' });

      expect(
        gateway.handleJoinChannel(
          client as never,
          {
            channelId: 'channel-1',
          } as never,
        ),
      ).toEqual({ success: true });
      expect(
        gateway.handleLeaveChannel(
          client as never,
          {
            channelId: 'channel-1',
          } as never,
        ),
      ).toEqual({ success: true });
    });
  });

  describe('handlePing', () => {
    it('returns a fallback pong for unauthenticated sockets', async () => {
      const { gateway } = createGateway();
      const { client } = makeClient();

      const result = await gateway.handlePing(
        client as never,
        {
          timestamp: 123,
        } as never,
      );

      expect(result.type).toBe('pong');
      expect(result.timestamp).toBe(123);
    });

    it('delegates to the heartbeat service for authenticated sockets', async () => {
      const { gateway, deps } = createGateway();
      const { client } = makeClient({ userId: 'user-1' });

      await expect(
        gateway.handlePing(client as never, { timestamp: 123 } as never),
      ).resolves.toEqual({
        type: 'pong',
        timestamp: 123,
        serverTime: 456,
      });
      expect(deps.heartbeatService.handlePing).toHaveBeenCalledWith(
        client,
        'user-1',
        {
          type: 'ping',
          timestamp: 123,
        },
      );
    });

    it('falls back to a local pong when heartbeat service is unavailable', async () => {
      const { gateway } = createGateway({
        heartbeatService: undefined,
      });
      const { client } = makeClient({ userId: 'user-1' });

      const result = await gateway.handlePing(
        client as never,
        {
          timestamp: 321,
        } as never,
      );

      expect(result.type).toBe('pong');
      expect(result.timestamp).toBe(321);
    });
  });

  describe('handleMessageAck', () => {
    it('rejects ACKs from unauthenticated sockets', async () => {
      const { gateway } = createGateway();
      const { client } = makeClient();

      await expect(
        gateway.handleMessageAck(
          client as never,
          {
            msgId: 'msg-1',
            ackType: 'read',
          } as never,
        ),
      ).resolves.toEqual({ error: 'Not authenticated' });
    });

    it('publishes ACKs upstream and emits a local receipt on success', async () => {
      const { gateway, deps } = createGateway();
      const { client } = makeClient({ userId: 'user-1' });

      await expect(
        gateway.handleMessageAck(
          client as never,
          {
            msgId: 'msg-1',
            ackType: 'read',
          } as never,
        ),
      ).resolves.toEqual({ success: true });

      expect(deps.gatewayMQService.publishUpstream).toHaveBeenCalledWith(
        expect.objectContaining({
          gatewayId: 'gateway-1',
          userId: 'user-1',
          socketId: 'socket-1',
        }),
      );
      expect(client.emit).toHaveBeenCalledWith(
        WS_EVENTS.SYSTEM.MESSAGE_ACK_RESPONSE,
        {
          msgId: 'msg-1',
          status: 'received',
        },
      );
    });

    it('returns an error when the upstream ACK publish fails', async () => {
      const { gateway, deps } = createGateway();
      const { client } = makeClient({ userId: 'user-1' });
      deps.gatewayMQService.publishUpstream.mockRejectedValueOnce(
        new Error('mq down'),
      );

      await expect(
        gateway.handleMessageAck(
          client as never,
          {
            msgId: 'msg-1',
            ackType: 'read',
          } as never,
        ),
      ).resolves.toEqual({ error: 'Failed to process ACK' });
    });

    it('falls back to a local receipt when MQ services are unavailable', async () => {
      const { gateway } = createGateway({
        gatewayMQService: undefined,
        clusterNodeService: undefined,
      });
      const { client } = makeClient({ userId: 'user-1' });

      await expect(
        gateway.handleMessageAck(
          client as never,
          {
            msgId: 'msg-2',
            ackType: 'delivered',
          } as never,
        ),
      ).resolves.toEqual({ success: true });

      expect(client.emit).toHaveBeenCalledWith(
        WS_EVENTS.SYSTEM.MESSAGE_ACK_RESPONSE,
        {
          msgId: 'msg-2',
          status: 'received',
        },
      );
    });
  });

  describe('sendToChannelMembers', () => {
    it('emits to every channel member except the excluded user', async () => {
      const { gateway, deps, emits } = createGateway();
      deps.channelMemberCacheService.getMemberIds.mockResolvedValueOnce([
        'user-1',
        'user-2',
        'user-3',
      ]);

      await gateway.sendToChannelMembers(
        'channel-1',
        'custom:event',
        { ok: true },
        'user-2',
      );

      expect(emits).toEqual([
        {
          room: 'user:user-1',
          event: 'custom:event',
          data: { ok: true },
        },
        {
          room: 'user:user-3',
          event: 'custom:event',
          data: { ok: true },
        },
      ]);
    });

    it('returns true on successful delivery', async () => {
      const { gateway, deps } = createGateway();
      deps.channelMemberCacheService.getMemberIds.mockResolvedValueOnce([
        'user-1',
      ]);

      const result = await gateway.sendToChannelMembers(
        'channel-1',
        'custom:event',
        { ok: true },
      );

      expect(result).toBe(true);
    });

    it('returns false and does not throw on member lookup failure', async () => {
      const { gateway, deps } = createGateway();
      deps.channelMemberCacheService.getMemberIds.mockRejectedValueOnce(
        new Error('cache down'),
      );

      const result = await gateway.sendToChannelMembers(
        'channel-1',
        'custom:event',
        { ok: true },
      );

      expect(result).toBe(false);
    });
  });

  describe('direct helper broadcasts', () => {
    it('sends directly to user rooms', async () => {
      const { gateway, emits } = createGateway();

      await expect(
        gateway.sendToUser('user-9', 'custom:user', { ok: true }),
      ).resolves.toBeUndefined();

      expect(emits).toEqual([
        {
          room: 'user:user-9',
          event: 'custom:user',
          data: { ok: true },
        },
      ]);
    });

    it('broadcasts directly to workspace rooms', async () => {
      const { gateway, emits } = createGateway();

      await expect(
        gateway.broadcastToWorkspace('workspace-9', 'custom:workspace', {
          ok: true,
        }),
      ).resolves.toBeUndefined();

      expect(emits).toEqual([
        {
          room: 'workspace:workspace-9',
          event: 'custom:workspace',
          data: { ok: true },
        },
      ]);
    });
  });

  describe('read status, typing, and reactions', () => {
    it('marks a channel as read and broadcasts the update', async () => {
      const { gateway, deps } = createGateway();
      const { client } = makeClient({ userId: 'user-1' });
      const sendSpy = jest
        .spyOn(gateway, 'sendToChannelMembers')
        .mockResolvedValue(undefined);

      await expect(
        gateway.handleMarkAsRead(
          client as never,
          {
            channelId: 'channel-1',
            messageId: 'msg-1',
          } as never,
        ),
      ).resolves.toEqual({ success: true });

      expect(deps.channelsService.assertReadAccess).toHaveBeenCalledWith(
        'channel-1',
        'user-1',
      );
      expect(deps.messagesService.markAsRead).toHaveBeenCalledWith(
        'channel-1',
        'user-1',
        'msg-1',
      );
      expect(sendSpy).toHaveBeenCalledWith(
        'channel-1',
        WS_EVENTS.READ_STATUS.UPDATED,
        {
          channelId: 'channel-1',
          userId: 'user-1',
          lastReadMessageId: 'msg-1',
        },
      );
    });

    it('handles typing start/stop by updating Redis and broadcasting', async () => {
      const { gateway, deps } = createGateway();
      const { client } = makeClient({
        userId: 'user-1',
        username: 'alice',
      });
      const sendSpy = jest
        .spyOn(gateway, 'sendToChannelMembers')
        .mockResolvedValue(undefined);

      await expect(
        gateway.handleTypingStart(
          client as never,
          {
            channelId: 'channel-1',
          } as never,
        ),
      ).resolves.toEqual({ success: true });
      await expect(
        gateway.handleTypingStop(
          client as never,
          {
            channelId: 'channel-1',
          } as never,
        ),
      ).resolves.toEqual({ success: true });

      expect(deps.redisService.set).toHaveBeenCalledWith(
        'im:typing:channel-1:user-1',
        '1',
        5,
      );
      expect(deps.redisService.del).toHaveBeenCalledWith(
        'im:typing:channel-1:user-1',
      );
      expect(sendSpy).toHaveBeenCalledWith(
        'channel-1',
        WS_EVENTS.TYPING.USER_TYPING,
        expect.objectContaining({
          channelId: 'channel-1',
          userId: 'user-1',
        }),
        'user-1',
      );
    });

    it('adds and removes reactions before broadcasting to channel members', async () => {
      const { gateway, deps } = createGateway();
      const { client } = makeClient({ userId: 'user-1' });
      const sendSpy = jest
        .spyOn(gateway, 'sendToChannelMembers')
        .mockResolvedValue(undefined);

      await expect(
        gateway.handleAddReaction(
          client as never,
          {
            messageId: 'msg-1',
            emoji: ':+1:',
          } as never,
        ),
      ).resolves.toEqual({ success: true });
      await expect(
        gateway.handleRemoveReaction(
          client as never,
          {
            messageId: 'msg-1',
            emoji: ':+1:',
          } as never,
        ),
      ).resolves.toEqual({ success: true });

      expect(deps.messagesService.addReaction).toHaveBeenCalledWith(
        'msg-1',
        'user-1',
        ':+1:',
      );
      expect(deps.messagesService.removeReaction).toHaveBeenCalledWith(
        'msg-1',
        'user-1',
        ':+1:',
      );
      expect(sendSpy).toHaveBeenCalledWith(
        'channel-1',
        WS_EVENTS.REACTION.ADDED,
        {
          messageId: 'msg-1',
          userId: 'user-1',
          emoji: ':+1:',
        },
      );
      expect(sendSpy).toHaveBeenCalledWith(
        'channel-1',
        WS_EVENTS.REACTION.REMOVED,
        {
          messageId: 'msg-1',
          userId: 'user-1',
          emoji: ':+1:',
        },
      );
    });
  });

  describe('workspace and observe handlers', () => {
    it('refuses workspace joins for non-members', async () => {
      const { gateway, deps } = createGateway();
      const { client } = makeClient({ userId: 'user-1' });
      deps.workspaceService.isWorkspaceMember.mockResolvedValueOnce(false);

      await expect(
        gateway.handleJoinWorkspace(client as never, {
          workspaceId: 'workspace-1',
        }),
      ).resolves.toEqual({ error: 'Not a member of this workspace' });

      expect(client.join).not.toHaveBeenCalled();
    });

    it('joins workspace rooms and emits the current member list', async () => {
      const { gateway, deps } = createGateway();
      const { client } = makeClient({ userId: 'user-1' });
      deps.workspaceService.getWorkspaceMembers.mockResolvedValueOnce([
        { userId: 'user-1' },
        { userId: 'user-2' },
      ]);

      await expect(
        gateway.handleJoinWorkspace(client as never, {
          workspaceId: 'workspace-1',
        }),
      ).resolves.toEqual({ success: true });

      expect(client.join).toHaveBeenCalledWith('workspace:workspace-1');
      expect(client.emit).toHaveBeenCalledWith(
        WS_EVENTS.WORKSPACE.MEMBERS_LIST,
        {
          workspaceId: 'workspace-1',
          members: [{ userId: 'user-1' }, { userId: 'user-2' }],
        },
      );
    });

    it('observes channels only when the user belongs to the same tenant', async () => {
      const { gateway, deps } = createGateway();
      const { client } = makeClient({ userId: 'user-1' });

      await gateway.handleChannelObserve(client as never, {
        channelId: 'channel-1',
      });
      expect(client.join).toHaveBeenCalledWith('channel-1');

      deps.channelsService.isUserInTenant.mockResolvedValueOnce(false);
      await gateway.handleChannelObserve(client as never, {
        channelId: 'channel-1',
      });
      expect(client.join).toHaveBeenCalledTimes(1);
    });

    it('ignores observe requests with missing auth, payload, or channel metadata', async () => {
      const { gateway, deps } = createGateway();
      const { client } = makeClient();

      await gateway.handleChannelObserve(client as never, {
        channelId: 'channel-1',
      });
      await gateway.handleChannelObserve(
        makeClient({ userId: 'user-1' }).client as never,
        {
          channelId: '',
        },
      );
      deps.channelsService.findById.mockResolvedValueOnce(null);
      await gateway.handleChannelObserve(
        makeClient({ userId: 'user-1' }).client as never,
        {
          channelId: 'channel-2',
        },
      );
      deps.channelsService.findById.mockResolvedValueOnce({
        id: 'channel-3',
      });
      await gateway.handleChannelObserve(
        makeClient({ userId: 'user-1' }).client as never,
        {
          channelId: 'channel-3',
        },
      );

      expect(client.join).not.toHaveBeenCalled();
    });

    it('ignores empty unobserve payloads and leaves channel rooms when provided', async () => {
      const { gateway } = createGateway();
      const { client } = makeClient({ userId: 'user-1' });

      await gateway.handleChannelUnobserve(client as never, {
        channelId: '',
      });
      await gateway.handleChannelUnobserve(client as never, {
        channelId: 'channel-1',
      });

      expect(client.leave).toHaveBeenCalledTimes(1);
      expect(client.leave).toHaveBeenCalledWith('channel-1');
    });
  });

  describe('streaming handlers', () => {
    it('rejects streaming start for non-bot users', async () => {
      const { gateway } = createGateway();
      const { client } = makeClient({ userId: 'user-1', isBot: false });

      await expect(
        gateway.handleStreamingStart(
          client as never,
          {
            streamId: 'stream-1',
            channelId: 'channel-1',
          } as never,
        ),
      ).resolves.toEqual({ error: 'Only bot users can stream messages' });
    });

    it('rejects streaming start when the bot is not in the channel', async () => {
      const { gateway, deps } = createGateway();
      const { client } = makeClient({ userId: 'bot-1', isBot: true });
      deps.channelsService.isMember.mockResolvedValueOnce(false);

      await expect(
        gateway.handleStreamingStart(
          client as never,
          {
            streamId: 'stream-1',
            channelId: 'channel-1',
          } as never,
        ),
      ).resolves.toEqual({ error: 'Not a member of this channel' });
    });

    it('stores streaming sessions and broadcasts start events for bots', async () => {
      const { gateway, deps } = createGateway();
      const { client } = makeClient({ userId: 'bot-1', isBot: true });
      const sendSpy = jest
        .spyOn(gateway, 'sendToChannelMembers')
        .mockResolvedValue(undefined);

      await expect(
        gateway.handleStreamingStart(
          client as never,
          {
            streamId: 'stream-1',
            channelId: 'channel-1',
            parentId: 'msg-parent',
            metadata: { foo: 'bar' },
          } as never,
        ),
      ).resolves.toEqual({ success: true });

      expect(deps.redisService.set).toHaveBeenCalledWith(
        REDIS_KEYS.STREAMING_SESSION('stream-1'),
        expect.stringContaining('"channelId":"channel-1"'),
        120,
      );
      expect(deps.redisService.sadd).toHaveBeenCalledWith(
        REDIS_KEYS.BOT_ACTIVE_STREAMS('bot-1'),
        'stream-1',
      );
      expect(sendSpy).toHaveBeenCalledWith(
        'channel-1',
        WS_EVENTS.STREAMING.START,
        expect.objectContaining({
          streamId: 'stream-1',
          channelId: 'channel-1',
          senderId: 'bot-1',
        }),
      );
    });

    it('refreshes TTL and broadcasts content deltas for bot streams', async () => {
      const { gateway, deps } = createGateway();
      const { client } = makeClient({ userId: 'bot-1', isBot: true });
      const sendSpy = jest
        .spyOn(gateway, 'sendToChannelMembers')
        .mockResolvedValue(undefined);

      await expect(
        gateway.handleStreamingDelta(
          client as never,
          {
            streamId: 'stream-1',
            channelId: 'channel-1',
            content: 'hello',
          } as never,
        ),
      ).resolves.toEqual({ success: true });
      await expect(
        gateway.handleStreamingThinkingDelta(
          client as never,
          {
            streamId: 'stream-1',
            channelId: 'channel-1',
            content: 'thinking',
          } as never,
        ),
      ).resolves.toEqual({ success: true });

      expect(deps.redisService.expire).toHaveBeenCalledWith(
        REDIS_KEYS.STREAMING_SESSION('stream-1'),
        120,
      );
      expect(sendSpy).toHaveBeenCalledWith(
        'channel-1',
        WS_EVENTS.STREAMING.CONTENT,
        expect.objectContaining({
          senderId: 'bot-1',
          content: 'hello',
        }),
      );
      expect(sendSpy).toHaveBeenCalledWith(
        'channel-1',
        WS_EVENTS.STREAMING.THINKING_CONTENT,
        expect.objectContaining({
          senderId: 'bot-1',
          content: 'thinking',
        }),
      );
    });

    it('rejects streaming updates from non-bot sockets', async () => {
      const { gateway } = createGateway();
      const { client } = makeClient({ userId: 'user-1', isBot: false });

      await expect(
        gateway.handleStreamingDelta(
          client as never,
          {
            streamId: 'stream-1',
            channelId: 'channel-1',
            content: 'hello',
          } as never,
        ),
      ).resolves.toEqual({ error: 'Only bot users can stream messages' });
      await expect(
        gateway.handleStreamingThinkingDelta(
          client as never,
          {
            streamId: 'stream-1',
            channelId: 'channel-1',
            content: 'thinking',
          } as never,
        ),
      ).resolves.toEqual({ error: 'Only bot users can stream messages' });
      await expect(
        gateway.handleStreamingEnd(
          client as never,
          {
            streamId: 'stream-1',
            channelId: 'channel-1',
          } as never,
        ),
      ).resolves.toEqual({ error: 'Only bot users can stream messages' });
      await expect(
        gateway.handleStreamingAbort(
          client as never,
          {
            streamId: 'stream-1',
            channelId: 'channel-1',
            reason: 'disconnect',
          } as never,
        ),
      ).resolves.toEqual({ error: 'Only bot users can stream messages' });
    });

    it('cleans up state and broadcasts the truncated final message on stream end', async () => {
      const { gateway, deps } = createGateway();
      const { client } = makeClient({ userId: 'bot-1', isBot: true });
      const sendSpy = jest
        .spyOn(gateway, 'sendToChannelMembers')
        .mockResolvedValue(undefined);
      const finalMessage = { id: 'msg-1', content: 'done' };
      const truncatedMessage = { id: 'msg-1', content: 'done (truncated)' };
      deps.messagesService.truncateForPreview.mockReturnValue(truncatedMessage);

      await expect(
        gateway.handleStreamingEnd(
          client as never,
          {
            streamId: 'stream-1',
            channelId: 'channel-1',
            message: finalMessage,
          } as never,
        ),
      ).resolves.toEqual({ success: true });

      expect(deps.redisService.del).toHaveBeenCalledWith(
        REDIS_KEYS.STREAMING_SESSION('stream-1'),
      );
      expect(deps.redisService.srem).toHaveBeenCalledWith(
        REDIS_KEYS.BOT_ACTIVE_STREAMS('bot-1'),
        'stream-1',
      );
      expect(sendSpy).toHaveBeenCalledWith(
        'channel-1',
        WS_EVENTS.STREAMING.END,
        expect.objectContaining({
          senderId: 'bot-1',
        }),
      );
      expect(deps.messagesService.truncateForPreview).toHaveBeenCalledWith(
        finalMessage,
      );
      expect(sendSpy).toHaveBeenCalledWith(
        'channel-1',
        WS_EVENTS.MESSAGE.NEW,
        truncatedMessage,
      );
      expect(metricFns.messagesTotalAdd).toHaveBeenCalledWith(1);
    });

    it('ends bot streams without rebroadcasting a final message when none is provided', async () => {
      const { gateway, deps } = createGateway();
      const { client } = makeClient({ userId: 'bot-1', isBot: true });
      const sendSpy = jest
        .spyOn(gateway, 'sendToChannelMembers')
        .mockResolvedValue(undefined);

      await expect(
        gateway.handleStreamingEnd(
          client as never,
          {
            streamId: 'stream-2',
            channelId: 'channel-1',
          } as never,
        ),
      ).resolves.toEqual({ success: true });

      expect(sendSpy).toHaveBeenCalledTimes(1);
      expect(sendSpy).toHaveBeenCalledWith(
        'channel-1',
        WS_EVENTS.STREAMING.END,
        expect.objectContaining({
          senderId: 'bot-1',
        }),
      );
      expect(metricFns.messagesTotalAdd).not.toHaveBeenCalled();
      expect(deps.redisService.del).toHaveBeenCalledWith(
        REDIS_KEYS.STREAMING_SESSION('stream-2'),
      );
    });

    it('cleans up state and broadcasts abort events', async () => {
      const { gateway, deps } = createGateway();
      const { client } = makeClient({ userId: 'bot-1', isBot: true });
      const sendSpy = jest
        .spyOn(gateway, 'sendToChannelMembers')
        .mockResolvedValue(undefined);

      await expect(
        gateway.handleStreamingAbort(
          client as never,
          {
            streamId: 'stream-1',
            channelId: 'channel-1',
            reason: 'cancelled',
          } as never,
        ),
      ).resolves.toEqual({ success: true });

      expect(deps.redisService.del).toHaveBeenCalledWith(
        REDIS_KEYS.STREAMING_SESSION('stream-1'),
      );
      expect(deps.redisService.srem).toHaveBeenCalledWith(
        REDIS_KEYS.BOT_ACTIVE_STREAMS('bot-1'),
        'stream-1',
      );
      expect(sendSpy).toHaveBeenCalledWith(
        'channel-1',
        WS_EVENTS.STREAMING.ABORT,
        expect.objectContaining({
          senderId: 'bot-1',
          reason: 'cancelled',
        }),
      );
    });
  });

  describe('cleanupBotStreams', () => {
    it('returns early when the bot has no active streams', async () => {
      const { gateway, deps } = createGateway();
      const sendSpy = jest
        .spyOn(gateway, 'sendToChannelMembers')
        .mockResolvedValue(undefined);

      await (gateway as any).cleanupBotStreams('bot-1');

      expect(sendSpy).not.toHaveBeenCalled();
      expect(deps.redisService.get).not.toHaveBeenCalled();
      expect(deps.redisService.del).not.toHaveBeenCalledWith(
        REDIS_KEYS.BOT_ACTIVE_STREAMS('bot-1'),
      );
    });

    it('broadcasts aborts for active streams and deletes their Redis state', async () => {
      const { gateway, deps } = createGateway();
      const sendSpy = jest
        .spyOn(gateway, 'sendToChannelMembers')
        .mockResolvedValue(undefined);
      deps.redisService.smembers.mockResolvedValueOnce(['stream-1']);
      deps.redisService.get.mockResolvedValueOnce(
        JSON.stringify({
          channelId: 'channel-1',
          senderId: 'bot-1',
          startedAt: Date.now(),
        }),
      );

      await (gateway as any).cleanupBotStreams('bot-1');

      expect(sendSpy).toHaveBeenCalledWith(
        'channel-1',
        WS_EVENTS.STREAMING.ABORT,
        {
          streamId: 'stream-1',
          channelId: 'channel-1',
          senderId: 'bot-1',
          reason: 'disconnect',
        },
      );
      expect(deps.redisService.del).toHaveBeenCalledWith(
        REDIS_KEYS.STREAMING_SESSION('stream-1'),
      );
      expect(deps.redisService.del).toHaveBeenCalledWith(
        REDIS_KEYS.BOT_ACTIVE_STREAMS('bot-1'),
      );
    });

    it('skips abort broadcasts when stream session data is already gone', async () => {
      const { gateway, deps } = createGateway();
      const sendSpy = jest
        .spyOn(gateway, 'sendToChannelMembers')
        .mockResolvedValue(undefined);
      deps.redisService.smembers.mockResolvedValueOnce(['stream-2']);
      deps.redisService.get.mockResolvedValueOnce(null);

      await (gateway as any).cleanupBotStreams('bot-1');

      expect(sendSpy).not.toHaveBeenCalled();
      expect(deps.redisService.del).toHaveBeenCalledWith(
        REDIS_KEYS.BOT_ACTIVE_STREAMS('bot-1'),
      );
    });

    it('swallows parsing and Redis errors while cleaning up bot streams', async () => {
      const { gateway, deps } = createGateway();
      const loggerError = jest
        .spyOn((gateway as any).logger, 'error')
        .mockImplementation(() => undefined);
      deps.redisService.smembers.mockResolvedValueOnce(['stream-3']);
      deps.redisService.get.mockResolvedValueOnce('{');

      await expect(
        (gateway as any).cleanupBotStreams('bot-1'),
      ).resolves.toBeUndefined();

      expect(loggerError).toHaveBeenCalledWith(
        '[WS] Failed to cleanup bot streams for bot-1:',
        expect.any(Error),
      );
    });
  });

  describe('handleUserOfflineEvent', () => {
    it('marks users offline and broadcasts when no active sessions remain', async () => {
      const { gateway, deps, emits } = createGateway();
      deps.workspaceService.getWorkspaceIdsByUserId.mockResolvedValueOnce([
        'workspace-1',
        'workspace-2',
      ]);

      await gateway.handleUserOfflineEvent({
        userId: 'user-1',
        socketId: 'socket-1',
        reason: 'zombie',
        gatewayId: 'gateway-1',
      });

      expect(deps.usersService.setOffline).toHaveBeenCalledWith('user-1');
      expect(emits).toEqual([
        {
          room: 'workspace:workspace-1',
          event: WS_EVENTS.USER.OFFLINE,
          data: {
            userId: 'user-1',
            workspaceId: 'workspace-1',
          },
        },
        {
          room: 'workspace:workspace-2',
          event: WS_EVENTS.USER.OFFLINE,
          data: {
            userId: 'user-1',
            workspaceId: 'workspace-2',
          },
        },
      ]);
    });

    it('keeps users online when another active session still exists', async () => {
      const { gateway, deps } = createGateway();
      deps.sessionService.hasActiveDeviceSessions.mockResolvedValueOnce(true);

      await gateway.handleUserOfflineEvent({
        userId: 'user-1',
        socketId: 'socket-1',
        reason: 'zombie',
        gatewayId: 'gateway-1',
      });

      expect(deps.usersService.setOffline).not.toHaveBeenCalled();
    });
  });

  describe('relation event helpers', () => {
    it('emitRelationChanged broadcasts via sendToChannelMembers with RELATION_CHANGED event', async () => {
      const { gateway } = createGateway();
      const spy = jest
        .spyOn(gateway, 'sendToChannelMembers')
        .mockResolvedValue(true);

      const payload = {
        channelId: 'c1',
        sourceMessageId: 'm1',
        propertyDefinitionId: 'def-1',
        propertyKey: 'parentMessage',
        relationKind: 'parent' as const,
        action: 'added' as const,
        addedTargetIds: ['m2'],
        removedTargetIds: [],
        currentTargetIds: ['m2'],
        performedBy: 'u1',
        timestamp: '2026-04-20T00:00:00.000Z',
      };

      await gateway.emitRelationChanged(payload);

      expect(spy).toHaveBeenCalledWith(
        'c1',
        WS_EVENTS.PROPERTY.RELATION_CHANGED,
        payload,
      );
    });

    it('emitRelationsPurged broadcasts via sendToChannelMembers with RELATIONS_PURGED event and carries affectedSourceIds', async () => {
      const { gateway } = createGateway();
      const spy = jest
        .spyOn(gateway, 'sendToChannelMembers')
        .mockResolvedValue(true);

      const payload = {
        channelId: 'c1',
        deletedMessageId: 'del-1',
        affectedSourceIds: ['src-1', 'src-2'],
      };

      await gateway.emitRelationsPurged(payload);

      expect(spy).toHaveBeenCalledWith(
        'c1',
        WS_EVENTS.PROPERTY.RELATIONS_PURGED,
        payload,
      );
    });

    it('emitRelationsPurged still propagates the full payload to all channel members', async () => {
      const { gateway, deps, emits } = createGateway();
      deps.channelMemberCacheService.getMemberIds.mockResolvedValueOnce([
        'user-1',
        'user-2',
      ]);

      const payload = {
        channelId: 'channel-1',
        deletedMessageId: 'del-msg',
        affectedSourceIds: ['src-a'],
      };

      await gateway.emitRelationsPurged(payload);

      expect(emits).toEqual([
        {
          room: 'user:user-1',
          event: WS_EVENTS.PROPERTY.RELATIONS_PURGED,
          data: payload,
        },
        {
          room: 'user:user-2',
          event: WS_EVENTS.PROPERTY.RELATIONS_PURGED,
          data: payload,
        },
      ]);
    });
  });
});

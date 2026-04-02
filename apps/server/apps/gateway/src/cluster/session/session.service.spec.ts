import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { SessionService } from './session.service.js';

function createPipeline() {
  return {
    hset: jest.fn<any>().mockReturnThis(),
    hget: jest.fn<any>().mockReturnThis(),
    hgetall: jest.fn<any>().mockReturnThis(),
    exists: jest.fn<any>().mockReturnThis(),
    expire: jest.fn<any>().mockReturnThis(),
    zadd: jest.fn<any>().mockReturnThis(),
    zrem: jest.fn<any>().mockReturnThis(),
    sadd: jest.fn<any>().mockReturnThis(),
    srem: jest.fn<any>().mockReturnThis(),
    del: jest.fn<any>().mockReturnThis(),
    exec: jest.fn<any>().mockResolvedValue(undefined),
  };
}

function createRedisMock() {
  const pipeline = createPipeline();

  return {
    pipeline,
    client: {
      pipeline: jest.fn<any>(() => pipeline),
      hset: jest.fn<any>().mockResolvedValue(1),
      zrem: jest.fn<any>().mockResolvedValue(1),
      hdel: jest.fn<any>().mockResolvedValue(1),
      del: jest.fn<any>().mockResolvedValue(1),
      zrangebyscore: jest.fn<any>().mockResolvedValue([]),
    },
    redisService: {
      getClient: jest.fn<any>(),
      hgetall: jest.fn<any>().mockResolvedValue({}),
      hget: jest.fn<any>().mockResolvedValue(null),
      exists: jest.fn<any>().mockResolvedValue(0),
      smembers: jest.fn<any>().mockResolvedValue([]),
    },
  };
}

describe('SessionService', () => {
  let service: SessionService;
  let pipeline: ReturnType<typeof createPipeline>;
  let client: ReturnType<typeof createRedisMock>['client'];
  let redisService: ReturnType<typeof createRedisMock>['redisService'];

  beforeEach(() => {
    const mock = createRedisMock();
    pipeline = mock.pipeline;
    client = mock.client;
    redisService = mock.redisService;
    redisService.getClient.mockReturnValue(client);
    service = new SessionService(redisService as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  describe('setUserSession / getUserSession / removeUserSession / updateHeartbeat', () => {
    it('stores a user session with serialized device info and heartbeat tracking', async () => {
      const session = {
        gatewayId: 'gw-1',
        socketId: 'socket-1',
        loginTime: 111,
        lastActiveTime: 222,
        deviceInfo: {
          platform: 'macos',
          version: '1.0.0',
          deviceId: 'device-1',
        },
      };

      await service.setUserSession('user-1', session);

      expect(redisService.getClient).toHaveBeenCalledTimes(1);
      expect(pipeline.hset).toHaveBeenCalledWith('im:route:user:user-1', {
        gatewayId: 'gw-1',
        socketId: 'socket-1',
        loginTime: '111',
        lastActiveTime: '222',
        deviceInfo: JSON.stringify(session.deviceInfo),
      });
      expect(pipeline.expire).toHaveBeenCalledWith('im:route:user:user-1', 300);
      expect(pipeline.zadd).toHaveBeenCalledWith(
        'im:heartbeat_check',
        222,
        'user-1:socket-1',
      );
      expect(pipeline.exec).toHaveBeenCalledTimes(1);
    });

    it('returns null when user session data is missing', async () => {
      redisService.hgetall.mockResolvedValueOnce({});

      await expect(service.getUserSession('missing')).resolves.toBeNull();
    });

    it('parses a stored user session and device info', async () => {
      redisService.hgetall.mockResolvedValueOnce({
        gatewayId: 'gw-2',
        socketId: 'socket-2',
        loginTime: '123',
        lastActiveTime: '456',
        deviceInfo: JSON.stringify({
          platform: 'windows',
          version: '2.0.0',
          deviceId: 'device-2',
        }),
      });

      await expect(service.getUserSession('user-2')).resolves.toEqual({
        gatewayId: 'gw-2',
        socketId: 'socket-2',
        loginTime: 123,
        lastActiveTime: 456,
        deviceInfo: {
          platform: 'windows',
          version: '2.0.0',
          deviceId: 'device-2',
        },
      });
    });

    it('removes only the heartbeat marker when the socket id mismatches', async () => {
      redisService.hget.mockResolvedValueOnce('socket-new');

      await service.removeUserSession('user-3', 'socket-old');

      expect(redisService.getClient).toHaveBeenCalledTimes(1);
      expect(client.zrem).toHaveBeenCalledWith(
        'im:heartbeat_check',
        'user-3:socket-old',
      );
      expect(pipeline.exec).not.toHaveBeenCalled();
      expect(pipeline.del).not.toHaveBeenCalled();
    });

    it('deletes the session and heartbeat marker when the socket id matches', async () => {
      redisService.hget.mockResolvedValueOnce('socket-4');

      await service.removeUserSession('user-4', 'socket-4');

      expect(pipeline.del).toHaveBeenCalledWith('im:route:user:user-4');
      expect(pipeline.zrem).toHaveBeenCalledWith(
        'im:heartbeat_check',
        'user-4:socket-4',
      );
      expect(pipeline.exec).toHaveBeenCalledTimes(1);
    });

    it('returns false when heartbeat updates do not match the current session', async () => {
      redisService.hget.mockResolvedValueOnce('socket-current');

      await expect(
        service.updateHeartbeat('user-5', 'socket-other'),
      ).resolves.toBe(false);

      expect(redisService.getClient).not.toHaveBeenCalled();
      expect(pipeline.exec).not.toHaveBeenCalled();
    });

    it('updates heartbeat timestamps and TTL when the session matches', async () => {
      const now = 1_700_000_000_000;
      jest.spyOn(Date, 'now').mockReturnValue(now);
      redisService.hget.mockResolvedValueOnce('socket-6');

      await expect(service.updateHeartbeat('user-6', 'socket-6')).resolves.toBe(
        true,
      );

      expect(pipeline.hset).toHaveBeenCalledWith(
        'im:route:user:user-6',
        'lastActiveTime',
        String(now),
      );
      expect(pipeline.expire).toHaveBeenCalledWith('im:route:user:user-6', 300);
      expect(pipeline.zadd).toHaveBeenCalledWith(
        'im:heartbeat_check',
        now,
        'user-6:socket-6',
      );
      expect(pipeline.exec).toHaveBeenCalledTimes(1);
    });
  });

  describe('registerNode / updateNodeHeartbeat / unregisterNode / getActiveNodes / getNodeInfo', () => {
    it('registers, updates, and unregisters gateway nodes', async () => {
      const now = 1_700_000_000_123;
      jest.spyOn(Date, 'now').mockReturnValue(now);

      await service.registerNode({
        nodeId: 'node-1',
        address: '127.0.0.1:3000',
        startTime: 100,
        lastHeartbeat: 200,
        connectionCount: 3,
      });

      expect(pipeline.hset).toHaveBeenCalledWith('im:node:node-1', {
        nodeId: 'node-1',
        address: '127.0.0.1:3000',
        startTime: '100',
        lastHeartbeat: '200',
        connectionCount: '3',
      });
      expect(pipeline.expire).toHaveBeenCalledWith('im:node:node-1', 30);
      expect(pipeline.sadd).toHaveBeenCalledWith('im:nodes', 'node-1');
      expect(pipeline.zadd).toHaveBeenCalledWith(
        'im:node_connections',
        3,
        'node-1',
      );

      await service.updateNodeHeartbeat('node-1', 8);

      expect(pipeline.hset).toHaveBeenLastCalledWith('im:node:node-1', {
        lastHeartbeat: String(now),
        connectionCount: '8',
      });
      expect(pipeline.expire).toHaveBeenLastCalledWith('im:node:node-1', 30);
      expect(pipeline.zadd).toHaveBeenLastCalledWith(
        'im:node_connections',
        8,
        'node-1',
      );

      await service.unregisterNode('node-1');

      expect(pipeline.del).toHaveBeenCalledWith('im:node:node-1');
      expect(pipeline.srem).toHaveBeenCalledWith('im:nodes', 'node-1');
      expect(pipeline.zrem).toHaveBeenCalledWith(
        'im:node_connections',
        'node-1',
      );
    });

    it('returns active nodes and node info, including missing-node nulls', async () => {
      redisService.smembers.mockResolvedValueOnce(['node-a', 'node-b']);
      redisService.hgetall.mockResolvedValueOnce({
        nodeId: 'node-a',
        address: '10.0.0.1:3000',
        startTime: '1',
        lastHeartbeat: '2',
        connectionCount: '3',
      });
      redisService.hgetall.mockResolvedValueOnce({});

      await expect(service.getActiveNodes()).resolves.toEqual([
        'node-a',
        'node-b',
      ]);
      await expect(service.getNodeInfo('node-a')).resolves.toEqual({
        nodeId: 'node-a',
        address: '10.0.0.1:3000',
        startTime: 1,
        lastHeartbeat: 2,
        connectionCount: 3,
      });
      await expect(service.getNodeInfo('missing')).resolves.toBeNull();
    });
  });

  describe('getUsersGateways / groupUsersByGateway / isUserOnline / getOnlineUsers', () => {
    it('returns an empty map for empty user lists', async () => {
      await expect(service.getUsersGateways([])).resolves.toEqual(new Map());
      await expect(service.getOnlineUsers([])).resolves.toEqual([]);
      expect(redisService.getClient).not.toHaveBeenCalled();
    });

    it('maps users to gateways and groups them by gateway', async () => {
      pipeline.exec.mockResolvedValueOnce([
        [null, 'gw-a'],
        [null, null],
        [new Error('redis'), 'gw-c'],
        [null, 'gw-a'],
      ]);

      await expect(
        service.getUsersGateways(['user-a', 'user-b', 'user-c', 'user-d']),
      ).resolves.toEqual(
        new Map([
          ['user-a', 'gw-a'],
          ['user-d', 'gw-a'],
        ]),
      );

      jest.spyOn(service, 'getUsersGateways').mockResolvedValueOnce(
        new Map([
          ['user-a', 'gw-a'],
          ['user-b', 'gw-b'],
          ['user-c', 'gw-a'],
        ]),
      );

      await expect(
        service.groupUsersByGateway(['user-a', 'user-b', 'user-c']),
      ).resolves.toEqual(
        new Map([
          ['gw-a', ['user-a', 'user-c']],
          ['gw-b', ['user-b']],
        ]),
      );
    });

    it('checks online status from Redis and batch filters online users', async () => {
      redisService.exists.mockResolvedValueOnce(1);
      redisService.exists.mockResolvedValueOnce(0);

      await expect(service.isUserOnline('user-1')).resolves.toBe(true);
      await expect(service.isUserOnline('user-2')).resolves.toBe(false);

      pipeline.exec.mockResolvedValueOnce([
        [null, 1],
        [null, 0],
        [new Error('redis'), 1],
        [null, 1],
      ]);

      await expect(
        service.getOnlineUsers(['user-a', 'user-b', 'user-c', 'user-d']),
      ).resolves.toEqual(['user-a', 'user-d']);
    });
  });

  describe('getZombieSessions / removeFromHeartbeatCheck', () => {
    it('returns stale sessions and removes heartbeat entries', async () => {
      const now = 1_700_000_001_000;
      jest.spyOn(Date, 'now').mockReturnValue(now);

      client.zrangebyscore.mockResolvedValueOnce([
        'user-1:socket-1',
        'user-2:socket-2',
      ]);

      await expect(service.getZombieSessions(5_000)).resolves.toEqual([
        { userId: 'user-1', socketId: 'socket-1' },
        { userId: 'user-2', socketId: 'socket-2' },
      ]);

      expect(client.zrangebyscore).toHaveBeenCalledWith(
        'im:heartbeat_check',
        0,
        now - 5_000,
        'LIMIT',
        0,
        100,
      );

      await service.removeFromHeartbeatCheck('user-1', 'socket-1');

      expect(client.zrem).toHaveBeenCalledWith(
        'im:heartbeat_check',
        'user-1:socket-1',
      );
    });
  });

  describe('addDeviceSession / getAllDeviceSessions / getAllDeviceSessionsBatch / removeDeviceSession / updateDeviceHeartbeat / hasActiveDeviceSessions', () => {
    it('adds a device session and updates the primary route to the newest device', async () => {
      const now = 1_700_000_002_000;
      jest.spyOn(Date, 'now').mockReturnValue(now);

      await service.addDeviceSession('user-7', {
        socketId: 'socket-7',
        gatewayId: 'gw-7',
        loginTime: 700,
        lastActiveTime: now,
        deviceInfo: {
          platform: 'linux',
          version: '3.0.0',
          deviceId: 'device-7',
          userAgent: 'agent-7',
        },
      });

      expect(pipeline.hset).toHaveBeenCalledWith(
        'im:session:user:user-7',
        'socket-7',
        expect.stringContaining('"socketId":"socket-7"'),
      );
      expect(pipeline.expire).toHaveBeenCalledWith(
        'im:session:user:user-7',
        300,
      );
      expect(pipeline.hset).toHaveBeenCalledWith('im:route:user:user-7', {
        gatewayId: 'gw-7',
        socketId: 'socket-7',
        lastActiveTime: String(now),
      });
      expect(pipeline.zadd).toHaveBeenCalledWith(
        'im:heartbeat_check',
        now,
        'user-7:socket-7',
      );
    });

    it('returns parsed device sessions and handles empty batch results', async () => {
      redisService.hgetall.mockResolvedValueOnce({});
      redisService.hgetall.mockResolvedValueOnce({
        'socket-a': JSON.stringify({
          socketId: 'socket-a',
          gatewayId: 'gw-a',
          loginTime: 10,
          lastActiveTime: 20,
        }),
        'socket-b': JSON.stringify({
          socketId: 'socket-b',
          gatewayId: 'gw-b',
          loginTime: 30,
          lastActiveTime: 40,
        }),
      });

      await expect(service.getAllDeviceSessions('missing')).resolves.toEqual(
        [],
      );
      await expect(service.getAllDeviceSessions('user-8')).resolves.toEqual([
        {
          socketId: 'socket-a',
          gatewayId: 'gw-a',
          loginTime: 10,
          lastActiveTime: 20,
        },
        {
          socketId: 'socket-b',
          gatewayId: 'gw-b',
          loginTime: 30,
          lastActiveTime: 40,
        },
      ]);

      await expect(service.getAllDeviceSessionsBatch([])).resolves.toEqual(
        new Map(),
      );
      expect(redisService.getClient).toHaveBeenCalledTimes(0);

      pipeline.exec.mockResolvedValueOnce([
        [
          null,
          {
            'socket-a': JSON.stringify({
              socketId: 'socket-a',
              gatewayId: 'gw-a',
              loginTime: 10,
              lastActiveTime: 20,
            }),
          },
        ],
        [null, {}],
        [new Error('redis'), {}],
      ]);

      await expect(
        service.getAllDeviceSessionsBatch(['user-8', 'user-9', 'user-10']),
      ).resolves.toEqual(
        new Map([
          [
            'user-8',
            [
              {
                socketId: 'socket-a',
                gatewayId: 'gw-a',
                loginTime: 10,
                lastActiveTime: 20,
              },
            ],
          ],
        ]),
      );
    });

    it('clears the route when the last device session is removed', async () => {
      const getAllDeviceSessionsSpy = jest
        .spyOn(service, 'getAllDeviceSessions')
        .mockResolvedValueOnce([]);

      await service.removeDeviceSession('user-9', 'socket-9');

      expect(client.hdel).toHaveBeenCalledWith(
        'im:session:user:user-9',
        'socket-9',
      );
      expect(client.zrem).toHaveBeenCalledWith(
        'im:heartbeat_check',
        'user-9:socket-9',
      );
      expect(client.del).toHaveBeenCalledWith('im:route:user:user-9');
      expect(getAllDeviceSessionsSpy).toHaveBeenCalledWith('user-9');
    });

    it('updates the route to the most recent remaining device session', async () => {
      jest.spyOn(service, 'getAllDeviceSessions').mockResolvedValueOnce([
        {
          socketId: 'socket-old',
          gatewayId: 'gw-old',
          loginTime: 10,
          lastActiveTime: 100,
        },
        {
          socketId: 'socket-new',
          gatewayId: 'gw-new',
          loginTime: 20,
          lastActiveTime: 200,
        },
      ]);

      await service.removeDeviceSession('user-10', 'socket-removed');

      expect(client.hdel).toHaveBeenCalledWith(
        'im:session:user:user-10',
        'socket-removed',
      );
      expect(client.zrem).toHaveBeenCalledWith(
        'im:heartbeat_check',
        'user-10:socket-removed',
      );
      expect(client.del).not.toHaveBeenCalled();
      expect(client.hset).toHaveBeenCalledWith('im:route:user:user-10', {
        gatewayId: 'gw-new',
        socketId: 'socket-new',
        lastActiveTime: '200',
      });
    });

    it('returns false for missing or malformed device heartbeats and updates the latest device heartbeat', async () => {
      redisService.hget.mockResolvedValueOnce(null);
      await expect(
        service.updateDeviceHeartbeat('user-11', 'socket-missing'),
      ).resolves.toBe(false);

      redisService.hget.mockResolvedValueOnce('not-json');
      await expect(
        service.updateDeviceHeartbeat('user-11', 'socket-bad'),
      ).resolves.toBe(false);

      const now = 1_700_000_003_000;
      jest.spyOn(Date, 'now').mockReturnValue(now);
      redisService.hget.mockResolvedValueOnce(
        JSON.stringify({
          socketId: 'socket-good',
          gatewayId: 'gw-good',
          loginTime: 300,
          lastActiveTime: 400,
        }),
      );

      await expect(
        service.updateDeviceHeartbeat('user-11', 'socket-good'),
      ).resolves.toBe(true);

      expect(pipeline.hset).toHaveBeenCalledWith(
        'im:session:user:user-11',
        'socket-good',
        JSON.stringify({
          socketId: 'socket-good',
          gatewayId: 'gw-good',
          loginTime: 300,
          lastActiveTime: now,
        }),
      );
      expect(pipeline.expire).toHaveBeenCalledWith(
        'im:session:user:user-11',
        300,
      );
      expect(pipeline.zadd).toHaveBeenCalledWith(
        'im:heartbeat_check',
        now,
        'user-11:socket-good',
      );
      expect(pipeline.expire).toHaveBeenCalledWith(
        'im:route:user:user-11',
        300,
      );
    });

    it('reports whether a user has any active device sessions', async () => {
      jest.spyOn(service, 'getAllDeviceSessions').mockResolvedValueOnce([]);
      await expect(service.hasActiveDeviceSessions('user-12')).resolves.toBe(
        false,
      );

      jest.spyOn(service, 'getAllDeviceSessions').mockResolvedValueOnce([
        {
          socketId: 'socket-12',
          gatewayId: 'gw-12',
          loginTime: 1,
          lastActiveTime: 2,
        },
      ]);
      await expect(service.hasActiveDeviceSessions('user-12')).resolves.toBe(
        true,
      );
    });
  });
});

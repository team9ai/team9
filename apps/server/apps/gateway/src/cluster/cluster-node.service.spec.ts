import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from '@jest/globals';
import { ClusterNodeService } from './cluster-node.service.js';

function createPipeline() {
  return {
    hset: jest.fn().mockReturnThis(),
    expire: jest.fn().mockReturnThis(),
    sadd: jest.fn().mockReturnThis(),
    zadd: jest.fn().mockReturnThis(),
    del: jest.fn().mockReturnThis(),
    srem: jest.fn().mockReturnThis(),
    zrem: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(undefined),
  };
}

describe('ClusterNodeService', () => {
  let pipeline: ReturnType<typeof createPipeline>;
  let client: {
    pipeline: jest.Mock;
    zrange: jest.Mock;
  };
  let redisService: {
    getClient: jest.Mock;
    smembers: jest.Mock;
    hgetall: jest.Mock;
  };
  let service: ClusterNodeService;

  beforeEach(() => {
    jest.useFakeTimers();
    process.env.HOSTNAME = 'gateway-test';
    pipeline = createPipeline();
    client = {
      pipeline: jest.fn(() => pipeline),
      zrange: jest.fn(),
    };
    redisService = {
      getClient: jest.fn(() => client),
      smembers: jest.fn(),
      hgetall: jest.fn(),
    };
    service = new ClusterNodeService(redisService as never);
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.clearAllTimers();
    jest.useRealTimers();
    delete process.env.HOSTNAME;
  });

  it('registers and unregisters the node on module lifecycle', async () => {
    await service.onModuleInit();

    expect(service.getNodeId()).toMatch(/^gateway-gateway-test-/);
    expect(pipeline.hset).toHaveBeenCalled();
    expect(pipeline.expire).toHaveBeenCalled();
    expect(pipeline.sadd).toHaveBeenCalledWith('im:nodes', service.getNodeId());
    expect(pipeline.zadd).toHaveBeenCalledWith(
      'im:node_connections',
      0,
      service.getNodeId(),
    );

    await service.onModuleDestroy();

    expect(pipeline.del).toHaveBeenCalledWith(`im:node:${service.getNodeId()}`);
    expect(pipeline.srem).toHaveBeenCalledWith('im:nodes', service.getNodeId());
    expect(pipeline.zrem).toHaveBeenCalledWith(
      'im:node_connections',
      service.getNodeId(),
    );
  });

  it('tracks connection counts and sends heartbeats', async () => {
    await service.onModuleInit();
    service.updateConnectionCount(3);
    service.incrementConnections();
    service.decrementConnections();
    service.decrementConnections();
    service.decrementConnections();
    service.decrementConnections();

    expect(service.getConnectionCount()).toBe(0);

    jest.advanceTimersByTime(10_000);
    await Promise.resolve();

    expect(pipeline.hset).toHaveBeenCalledWith(
      `im:node:${service.getNodeId()}`,
      expect.objectContaining({
        connectionCount: '0',
      }),
    );
  });

  it('returns active nodes, node info, and the least loaded node', async () => {
    redisService.smembers.mockResolvedValue(['node-a', 'node-b']);
    redisService.hgetall.mockResolvedValue({
      nodeId: 'node-a',
      address: '127.0.0.1:3000',
      startTime: '1',
      lastHeartbeat: '2',
      connectionCount: '3',
    });
    client.zrange.mockResolvedValue(['node-b']);

    await expect(service.getActiveNodes()).resolves.toEqual([
      'node-a',
      'node-b',
    ]);
    await expect(service.getNodeInfo('node-a')).resolves.toEqual({
      nodeId: 'node-a',
      address: '127.0.0.1:3000',
      startTime: 1,
      lastHeartbeat: 2,
      connectionCount: 3,
    });
    await expect(service.getLeastLoadedNode()).resolves.toBe('node-b');
  });

  it('returns null when node info is missing and handles heartbeat failures', async () => {
    const errorSpy = jest.spyOn((service as any).logger, 'error');
    redisService.hgetall.mockResolvedValue({});
    pipeline.exec
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('redis down'));

    await service.onModuleInit();
    jest.advanceTimersByTime(10_000);
    await Promise.resolve();

    await expect(service.getNodeInfo('missing')).resolves.toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to send heartbeat: Error: redis down',
    );
  });
});

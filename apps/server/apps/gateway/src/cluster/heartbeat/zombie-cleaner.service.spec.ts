import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from '@jest/globals';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ZombieCleanerService } from './zombie-cleaner.service.js';

describe('ZombieCleanerService', () => {
  let sessionService: {
    getZombieSessions: jest.Mock;
    removeUserSession: jest.Mock;
    removeFromHeartbeatCheck: jest.Mock;
  };
  let nodeService: {
    getNodeId: jest.Mock;
  };
  let eventEmitter: {
    emit: jest.Mock;
  };
  let service: ZombieCleanerService;
  let socket: {
    emit: jest.Mock;
    disconnect: jest.Mock;
  };
  let server: {
    sockets: {
      sockets: Map<string, typeof socket>;
    };
  };

  beforeEach(() => {
    jest.useFakeTimers();
    sessionService = {
      getZombieSessions: jest.fn(),
      removeUserSession: jest.fn().mockResolvedValue(undefined),
      removeFromHeartbeatCheck: jest.fn().mockResolvedValue(undefined),
    };
    nodeService = {
      getNodeId: jest.fn(() => 'node-1'),
    };
    eventEmitter = {
      emit: jest.fn(),
    };
    service = new ZombieCleanerService(
      sessionService as never,
      nodeService as never,
      eventEmitter as unknown as EventEmitter2,
    );
    socket = {
      emit: jest.fn(),
      disconnect: jest.fn(),
    };
    server = {
      sockets: {
        sockets: new Map([['socket-1', socket]]),
      },
    };
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('starts and stops the cleanup timer on module lifecycle', () => {
    service.onModuleInit();
    service.onModuleDestroy();

    expect((service as any).cleanerInterval).toBeNull();
  });

  it('skips cleanup when the server has not been set', async () => {
    await expect((service as any).cleanZombies()).resolves.toBeUndefined();
    expect(sessionService.getZombieSessions).not.toHaveBeenCalled();
  });

  it('disconnects zombie sockets, cleans redis state, and emits offline events', async () => {
    service.setServer(server as never);
    sessionService.getZombieSessions.mockResolvedValue([
      { userId: 'user-1', socketId: 'socket-1' },
    ]);

    await (service as any).cleanZombies();

    expect(socket.emit).toHaveBeenCalledWith('session_timeout', {
      reason: 'heartbeat_timeout',
      message: 'Connection timed out due to no heartbeat',
    });
    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(sessionService.removeUserSession).toHaveBeenCalledWith(
      'user-1',
      'socket-1',
    );
    expect(sessionService.removeFromHeartbeatCheck).toHaveBeenCalledWith(
      'user-1',
      'socket-1',
    );
    expect(eventEmitter.emit).toHaveBeenCalledWith('im.user.offline', {
      userId: 'user-1',
      socketId: 'socket-1',
      reason: 'zombie_cleanup',
      gatewayId: 'node-1',
    });
  });

  it('continues cleanup when no socket exists and forceCleanup delegates to the same path', async () => {
    service.setServer({
      sockets: { sockets: new Map() },
    } as never);

    await expect(
      service.forceCleanup('user-2', 'socket-missing'),
    ).resolves.toBeUndefined();

    expect(sessionService.removeUserSession).toHaveBeenCalledWith(
      'user-2',
      'socket-missing',
    );
    expect(eventEmitter.emit).toHaveBeenCalled();
  });

  it('logs and swallows cleanup failures', async () => {
    const errorSpy = jest.spyOn((service as any).logger, 'error');
    service.setServer(server as never);
    sessionService.getZombieSessions.mockRejectedValue(new Error('redis down'));
    sessionService.removeUserSession.mockRejectedValueOnce(
      new Error('remove failed'),
    );

    await (service as any).cleanZombies();
    await (service as any).cleanupZombieSession('user-1', 'socket-1');

    expect(errorSpy).toHaveBeenCalledWith(
      'Zombie cleaning failed: Error: redis down',
    );
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to clean zombie session user-1:socket-1: Error: remove failed',
    );
  });
});

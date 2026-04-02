import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { REDIS_KEYS } from '../../im/shared/constants/redis-keys.js';
import { HeartbeatService } from './heartbeat.service.js';

function createSocketMock(id = 'socket-1') {
  return {
    id,
    emit: jest.fn<any>(),
  };
}

describe('HeartbeatService', () => {
  let service: HeartbeatService;
  let sessionService: {
    updateHeartbeat: jest.Mock<any>;
  };
  let redisService: {
    expire: jest.Mock<any>;
  };
  let logger: {
    warn: jest.Mock<any>;
    debug: jest.Mock<any>;
    error: jest.Mock<any>;
  };

  beforeEach(() => {
    sessionService = {
      updateHeartbeat: jest.fn<any>(),
    };
    redisService = {
      expire: jest.fn<any>().mockResolvedValue(undefined),
    };
    service = new HeartbeatService(
      sessionService as never,
      redisService as never,
    );
    logger = {
      warn: jest.fn<any>(),
      debug: jest.fn<any>(),
      error: jest.fn<any>(),
    };
    (service as any).logger = logger;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('handles ping success by updating heartbeat, renewing legacy TTL, and returning pong', async () => {
    const now = 1_700_000_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(now);
    sessionService.updateHeartbeat.mockResolvedValueOnce(true);
    const client = createSocketMock('socket-1');
    const ping = { type: 'ping', timestamp: 123_456 };

    await expect(
      service.handlePing(client as never, 'user-1', ping as never),
    ).resolves.toEqual({
      type: 'pong',
      timestamp: 123_456,
      serverTime: now,
    });

    expect(sessionService.updateHeartbeat).toHaveBeenCalledWith(
      'user-1',
      'socket-1',
    );
    expect(client.emit).not.toHaveBeenCalled();
    expect(redisService.expire).toHaveBeenNthCalledWith(
      1,
      REDIS_KEYS.SOCKET_USER('socket-1'),
      300,
    );
    expect(redisService.expire).toHaveBeenNthCalledWith(
      2,
      REDIS_KEYS.USER_SOCKETS('user-1'),
      300,
    );
  });

  it('handles ping session mismatch by emitting session_expired and still renewing TTL', async () => {
    const now = 1_700_000_000_001;
    jest.spyOn(Date, 'now').mockReturnValue(now);
    sessionService.updateHeartbeat.mockResolvedValueOnce(false);
    const client = createSocketMock('socket-2');
    const ping = { type: 'ping', timestamp: 987_654 };

    await expect(
      service.handlePing(client as never, 'user-2', ping as never),
    ).resolves.toEqual({
      type: 'pong',
      timestamp: 987_654,
      serverTime: now,
    });

    expect(logger.warn).toHaveBeenCalledWith(
      'Heartbeat update failed for user user-2, session mismatch',
    );
    expect(client.emit).toHaveBeenCalledWith('session_expired', {
      reason: 'session_mismatch',
    });
    expect(redisService.expire).toHaveBeenNthCalledWith(
      1,
      REDIS_KEYS.SOCKET_USER('socket-2'),
      300,
    );
    expect(redisService.expire).toHaveBeenNthCalledWith(
      2,
      REDIS_KEYS.USER_SOCKETS('user-2'),
      300,
    );
  });

  it('swallows redis expire errors while renewing legacy socket TTL', async () => {
    redisService.expire.mockRejectedValueOnce(new Error('redis down'));

    await expect(
      (service as any).renewLegacySocketTTL('user-3', 'socket-3'),
    ).resolves.toBeUndefined();

    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining(
        'Failed to renew legacy socket TTL: Error: redis down',
      ),
    );
  });

  it('updates heartbeat on activity and logs errors when updateHeartbeat fails', async () => {
    sessionService.updateHeartbeat.mockResolvedValueOnce(undefined);

    await expect(
      service.updateOnActivity('user-4', 'socket-4'),
    ).resolves.toBeUndefined();

    expect(sessionService.updateHeartbeat).toHaveBeenCalledWith(
      'user-4',
      'socket-4',
    );
    expect(logger.error).not.toHaveBeenCalled();

    sessionService.updateHeartbeat.mockRejectedValueOnce(
      new Error('heartbeat failed'),
    );

    await expect(
      service.updateOnActivity('user-5', 'socket-5'),
    ).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(
      'Failed to update heartbeat: Error: heartbeat failed',
    );
  });
});

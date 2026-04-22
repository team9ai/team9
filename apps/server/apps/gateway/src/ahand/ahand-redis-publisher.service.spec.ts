import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { AhandRedisPublisher } from './ahand-redis-publisher.service.js';

describe('AhandRedisPublisher', () => {
  let redis: { publish: jest.Mock };
  let publisher: AhandRedisPublisher;

  beforeEach(() => {
    redis = { publish: jest.fn<any>().mockResolvedValue(1) };
    publisher = new AhandRedisPublisher(redis as never);
  });

  it('publishes to ahand:events:{ownerId} channel with JSON payload + publishedAt', async () => {
    await publisher.publishForOwner({
      ownerType: 'user',
      ownerId: 'u1',
      eventType: 'device.online',
      data: { hubDeviceId: 'd1' },
    });
    expect(redis.publish).toHaveBeenCalledTimes(1);
    const [ch, message] = redis.publish.mock.calls[0] as [string, string];
    expect(ch).toBe('ahand:events:u1');
    const parsed = JSON.parse(message);
    expect(parsed).toMatchObject({
      ownerType: 'user',
      eventType: 'device.online',
      data: { hubDeviceId: 'd1' },
    });
    expect(typeof parsed.publishedAt).toBe('string');
    expect(new Date(parsed.publishedAt).toISOString()).toBe(parsed.publishedAt);
  });

  it('logs debug when 0 subscribers (misconfig hint)', async () => {
    redis.publish.mockResolvedValue(0);
    const logSpy = jest
      .spyOn((publisher as any).logger, 'debug')
      .mockImplementation(() => undefined);
    await publisher.publishForOwner({
      ownerType: 'user',
      ownerId: 'u1',
      eventType: 'device.online',
      data: {},
    });
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('0 subscribers'),
    );
  });

  it('swallows publish errors (best-effort)', async () => {
    redis.publish.mockRejectedValue(new Error('redis down'));
    await expect(
      publisher.publishForOwner({
        ownerType: 'workspace',
        ownerId: 'ws-1',
        eventType: 'device.revoked',
        data: {},
      }),
    ).resolves.toBeUndefined();
  });

  it('swallows non-Error rejections via String coercion', async () => {
    redis.publish.mockImplementation(async () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw 'raw string error';
    });
    await expect(
      publisher.publishForOwner({
        ownerType: 'user',
        ownerId: 'u1',
        eventType: 'device.presence.changed',
        data: {},
      }),
    ).resolves.toBeUndefined();
  });
});

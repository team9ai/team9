import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { AhandRedisPublisher } from './ahand-redis-publisher.service.js';

describe('AhandRedisPublisher', () => {
  let redis: { publish: jest.Mock };
  let publisher: AhandRedisPublisher;

  beforeEach(() => {
    redis = { publish: jest.fn<any>().mockResolvedValue(1) };
    publisher = new AhandRedisPublisher(redis as never);
  });

  it('serialises event with emittedAt timestamp and publishes to ahand:events', async () => {
    await publisher.publishForOwner({
      ownerType: 'user',
      ownerId: 'u1',
      eventType: 'device.registered',
      data: { hubDeviceId: 'd1', nickname: 'MyMac' },
    });
    expect(redis.publish).toHaveBeenCalledTimes(1);
    const [channel, message] = redis.publish.mock.calls[0] as [string, string];
    expect(channel).toBe('ahand:events');
    const parsed = JSON.parse(message);
    expect(parsed).toMatchObject({
      ownerType: 'user',
      ownerId: 'u1',
      eventType: 'device.registered',
      data: { hubDeviceId: 'd1', nickname: 'MyMac' },
    });
    expect(typeof parsed.emittedAt).toBe('string');
    expect(new Date(parsed.emittedAt).toISOString()).toBe(parsed.emittedAt);
  });

  it('swallows Redis publish errors (presence is best-effort)', async () => {
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

  it('logs non-Error rejection via String coercion', async () => {
    redis.publish.mockImplementation(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw 'raw';
    });
    await expect(
      publisher.publishForOwner({
        ownerType: 'user',
        ownerId: 'u1',
        eventType: 'device.presence.changed',
        data: { hubDeviceId: 'h', isOnline: true },
      }),
    ).resolves.toBeUndefined();
  });
});

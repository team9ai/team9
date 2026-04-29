import {
  beforeEach,
  afterEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { AhandEventsSubscriber } from './ahand-events.subscriber.js';
import { AhandSessionDispatcher } from './ahand-session-dispatcher.service.js';

// ─── Minimal Redis mock ───────────────────────────────────────────────────
//
// Simulates the subset of ioredis API used by AhandEventsSubscriber:
// duplicate(), psubscribe(), punsubscribe(), disconnect(), on(), off().
//
// The `pmessage` event is fired synchronously via emit() so we don't need
// real pub/sub infrastructure in unit tests.

function makeRedis() {
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>();

  const client = {
    psubscribe: jest.fn<any>().mockResolvedValue(undefined),
    punsubscribe: jest.fn<any>().mockResolvedValue(undefined),
    disconnect: jest.fn<any>(),
    on: jest
      .fn<any>()
      .mockImplementation((event: string, fn: (...args: unknown[]) => void) => {
        if (!handlers.has(event)) handlers.set(event, new Set());
        handlers.get(event)!.add(fn);
      }),
    off: jest
      .fn<any>()
      .mockImplementation((event: string, fn: (...args: unknown[]) => void) => {
        handlers.get(event)?.delete(fn);
      }),
    emit: (event: string, ...args: unknown[]) => {
      handlers.get(event)?.forEach((fn) => fn(...args));
    },
  };

  return {
    redis: {
      ...client,
      duplicate: jest.fn<any>().mockReturnValue(client),
    },
    sub: client,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('AhandEventsSubscriber', () => {
  let subscriber: AhandEventsSubscriber;
  let redis: ReturnType<typeof makeRedis>;
  let dispatcher: { dispatch: jest.Mock };

  beforeEach(async () => {
    redis = makeRedis();
    dispatcher = { dispatch: jest.fn<any>().mockResolvedValue(undefined) };
    subscriber = new AhandEventsSubscriber(
      redis.redis as never,
      dispatcher as unknown as AhandSessionDispatcher,
    );
    await subscriber.onModuleInit();
  });

  afterEach(async () => {
    await subscriber.onModuleDestroy();
  });

  // ─── init ──────────────────────────────────────────────────────────────

  it('creates a duplicate connection and psubscribes on init', () => {
    expect(redis.redis.duplicate).toHaveBeenCalled();
    expect(redis.sub.psubscribe).toHaveBeenCalledWith('ahand:events:*');
  });

  // ─── happy path ────────────────────────────────────────────────────────

  it('dispatches a valid event to the session dispatcher', async () => {
    const payload = JSON.stringify({
      ownerType: 'user',
      eventType: 'device.online',
      data: { hubDeviceId: 'd1' },
      publishedAt: '2026-04-22T10:00:00Z',
    });
    redis.sub.emit('pmessage', 'ahand:events:*', 'ahand:events:u1', payload);
    // Let the async dispatch .catch() settle.
    await Promise.resolve();
    expect(dispatcher.dispatch).toHaveBeenCalledWith({
      ownerType: 'user',
      ownerId: 'u1',
      eventType: 'device.online',
      data: { hubDeviceId: 'd1' },
    });
  });

  it('passes data={} when payload.data is absent', async () => {
    const payload = JSON.stringify({
      ownerType: 'user',
      eventType: 'device.offline',
    });
    redis.sub.emit('pmessage', 'ahand:events:*', 'ahand:events:u2', payload);
    await Promise.resolve();
    expect(dispatcher.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ data: {} }),
    );
  });

  // ─── error / edge paths ────────────────────────────────────────────────

  it('logs and skips malformed JSON', async () => {
    const errSpy = jest
      .spyOn(
        (subscriber as unknown as { logger: { error: jest.Mock } }).logger,
        'error',
      )
      .mockImplementation(() => undefined);
    redis.sub.emit(
      'pmessage',
      'ahand:events:*',
      'ahand:events:u1',
      '{bad-json',
    );
    await Promise.resolve();
    expect(errSpy).toHaveBeenCalled();
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('logs and skips payload missing eventType', async () => {
    const warnSpy = jest
      .spyOn(
        (subscriber as unknown as { logger: { warn: jest.Mock } }).logger,
        'warn',
      )
      .mockImplementation(() => undefined);
    redis.sub.emit(
      'pmessage',
      'ahand:events:*',
      'ahand:events:u1',
      JSON.stringify({ ownerType: 'user', data: {} }),
    );
    await Promise.resolve();
    expect(warnSpy).toHaveBeenCalled();
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('dispatches with ownerType=undefined when payload omits it (dispatcher no-ops)', async () => {
    const payload = JSON.stringify({
      eventType: 'device.online',
      data: { hubDeviceId: 'd1' },
      publishedAt: 'x',
      // ownerType intentionally absent
    });
    redis.sub.emit('pmessage', 'ahand:events:*', 'ahand:events:u1', payload);
    await Promise.resolve();
    expect(dispatcher.dispatch).toHaveBeenCalledWith({
      ownerType: undefined,
      ownerId: 'u1',
      eventType: 'device.online',
      data: { hubDeviceId: 'd1' },
    });
  });

  it('logs and skips message on unexpected channel', async () => {
    const warnSpy = jest
      .spyOn(
        (subscriber as unknown as { logger: { warn: jest.Mock } }).logger,
        'warn',
      )
      .mockImplementation(() => undefined);
    // Channel that doesn't start with ahand:events:
    redis.sub.emit('pmessage', 'ahand:events:*', 'different:channel', '{}');
    await Promise.resolve();
    expect(warnSpy).toHaveBeenCalled();
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('logs and skips message on channel with empty ownerId (ahand:events: with no suffix)', async () => {
    const warnSpy = jest
      .spyOn(
        (subscriber as unknown as { logger: { warn: jest.Mock } }).logger,
        'warn',
      )
      .mockImplementation(() => undefined);
    // Channel is exactly 'ahand:events:' — ownerId becomes empty string after replace
    redis.sub.emit(
      'pmessage',
      'ahand:events:*',
      'ahand:events:',
      JSON.stringify({
        ownerType: 'user',
        eventType: 'device.online',
        data: {},
      }),
    );
    await Promise.resolve();
    expect(warnSpy).toHaveBeenCalled();
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('logs redis subscriber errors without crashing', () => {
    const errSpy = jest
      .spyOn(
        (subscriber as unknown as { logger: { error: jest.Mock } }).logger,
        'error',
      )
      .mockImplementation(() => undefined);
    redis.sub.emit('error', new Error('redis-boom'));
    expect(errSpy).toHaveBeenCalled();
  });

  it('logs reconnecting events', () => {
    const warnSpy = jest
      .spyOn(
        (subscriber as unknown as { logger: { warn: jest.Mock } }).logger,
        'warn',
      )
      .mockImplementation(() => undefined);
    redis.sub.emit('reconnecting');
    expect(warnSpy).toHaveBeenCalled();
  });

  it('catches dispatch errors without crashing the subscriber loop', async () => {
    dispatcher.dispatch.mockRejectedValueOnce(new Error('downstream-boom'));
    const errSpy = jest
      .spyOn(
        (subscriber as unknown as { logger: { error: jest.Mock } }).logger,
        'error',
      )
      .mockImplementation(() => undefined);
    const payload = JSON.stringify({
      ownerType: 'user',
      eventType: 'device.online',
      data: {},
      publishedAt: 'x',
    });
    redis.sub.emit('pmessage', 'ahand:events:*', 'ahand:events:u1', payload);
    // Wait for the .catch() to fire.
    await new Promise((r) => setTimeout(r, 10));
    expect(errSpy).toHaveBeenCalled();
    // Subsequent events still process.
    dispatcher.dispatch.mockResolvedValueOnce(undefined);
    redis.sub.emit('pmessage', 'ahand:events:*', 'ahand:events:u1', payload);
    await Promise.resolve();
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(2);
  });

  // ─── destroy ──────────────────────────────────────────────────────────

  it('onModuleDestroy unsubscribes, disconnects, nulls subscriber', async () => {
    await subscriber.onModuleDestroy();
    expect(redis.sub.punsubscribe).toHaveBeenCalledWith('ahand:events:*');
    expect(redis.sub.disconnect).toHaveBeenCalled();
    // Calling destroy twice is safe.
    await subscriber.onModuleDestroy();
    expect(redis.sub.punsubscribe).toHaveBeenCalledTimes(1);
  });

  it('after destroy, pmessage does not invoke dispatcher', async () => {
    await subscriber.onModuleDestroy();
    dispatcher.dispatch.mockClear();
    redis.sub.emit(
      'pmessage',
      'ahand:events:*',
      'ahand:events:u1',
      JSON.stringify({
        ownerType: 'user',
        eventType: 'device.online',
        data: {},
      }),
    );
    await Promise.resolve();
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('continues (does not throw) when psubscribe fails on init', async () => {
    // Setup a new subscriber where psubscribe rejects
    const failRedis = makeRedis();
    failRedis.sub.psubscribe.mockRejectedValue(new Error('Redis unavailable'));
    const failSubscriber = new AhandEventsSubscriber(
      failRedis.redis as never,
      dispatcher as unknown as AhandSessionDispatcher,
    );
    await expect(failSubscriber.onModuleInit()).resolves.toBeUndefined();
    await failSubscriber.onModuleDestroy();
  });

  it('re-subscribes on connect event after initial psubscribe failure', async () => {
    const failRedis = makeRedis();
    failRedis.sub.psubscribe
      .mockRejectedValueOnce(new Error('initial fail'))
      .mockResolvedValue(undefined);
    const failSubscriber = new AhandEventsSubscriber(
      failRedis.redis as never,
      dispatcher as unknown as AhandSessionDispatcher,
    );
    await failSubscriber.onModuleInit();
    // Simulate reconnect — 'connect' event fires
    failRedis.sub.emit('connect');
    // Allow the async psubscribe in the connect handler to settle
    await Promise.resolve();
    // psubscribe should have been called twice: once on init (failed), once on connect
    expect(failRedis.sub.psubscribe).toHaveBeenCalledTimes(2);
    await failSubscriber.onModuleDestroy();
  });
});

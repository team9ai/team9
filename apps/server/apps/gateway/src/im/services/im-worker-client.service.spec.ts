import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from '@jest/globals';
import { ImWorkerClientService } from './im-worker-client.service.js';

describe('ImWorkerClientService', () => {
  let service: ImWorkerClientService;
  let originalFetch: typeof global.fetch | undefined;
  let logSpy: jest.SpiedFunction<(...args: unknown[]) => void>;
  let debugSpy: jest.SpiedFunction<(...args: unknown[]) => void>;
  let errorSpy: jest.SpiedFunction<(...args: unknown[]) => void>;

  beforeEach(() => {
    jest.useFakeTimers();
    process.env.IM_WORKER_SERVICE_URL = 'http://worker.test';
    process.env.IM_WORKER_CLIENT_TIMEOUT = '4321';
    service = new ImWorkerClientService();
    originalFetch = global.fetch;
    global.fetch = jest.fn<any>();
    logSpy = jest.spyOn((service as any).logger, 'log');
    debugSpy = jest.spyOn((service as any).logger, 'debug');
    errorSpy = jest.spyOn((service as any).logger, 'error');
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.clearAllTimers();
    jest.useRealTimers();
    delete process.env.IM_WORKER_SERVICE_URL;
    delete process.env.IM_WORKER_CLIENT_TIMEOUT;
    if (originalFetch) {
      global.fetch = originalFetch;
    } else {
      delete (global as Partial<typeof global>).fetch;
    }
    jest.restoreAllMocks();
  });

  it('logs the configured base url on module init', () => {
    service.onModuleInit();

    expect(logSpy).toHaveBeenCalledWith(
      'IM Worker client initialized, targeting: http://worker.test',
    );
  });

  it('creates messages through the IM worker http api', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: jest.fn<any>().mockResolvedValue({
        msgId: 'msg-1',
        seqId: '7',
        status: 'queued',
      }),
    });

    const result = await service.createMessage({
      channelId: 'channel-1',
      content: 'hello',
    } as never);

    expect(global.fetch).toHaveBeenCalledWith(
      'http://worker.test/api/messages',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId: 'channel-1',
          content: 'hello',
        }),
        signal: expect.any(AbortSignal),
      }),
    );
    expect(debugSpy).toHaveBeenCalledWith(
      'Message created via IM Worker: msg-1 (queued)',
    );
    expect(result).toEqual({
      msgId: 'msg-1',
      seqId: '7',
      status: 'queued',
    });
  });

  it('throws a descriptive error for non-ok worker responses', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 502,
      text: jest.fn<any>().mockResolvedValue('bad gateway'),
    });

    await expect(
      service.createMessage({
        channelId: 'channel-1',
        content: 'hello',
      } as never),
    ).rejects.toThrow('IM Worker service error (502): bad gateway');
  });

  it('maps AbortError to a timeout message', async () => {
    const timeoutError = new Error('aborted');
    timeoutError.name = 'AbortError';
    (global.fetch as jest.Mock).mockRejectedValue(timeoutError);

    await expect(
      service.createMessage({
        channelId: 'channel-1',
        content: 'hello',
      } as never),
    ).rejects.toThrow('IM Worker service timeout after 4321ms');
  });

  it('logs and rethrows non-timeout fetch failures', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('network down'));

    await expect(
      service.createMessage({
        channelId: 'channel-1',
        content: 'hello',
      } as never),
    ).rejects.toThrow('network down');

    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to create message via IM Worker: Error: network down',
    );
  });

  it('reports worker health based on the http response', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true })
      .mockRejectedValueOnce(new Error('offline'));

    await expect(service.healthCheck()).resolves.toBe(true);
    await expect(service.healthCheck()).resolves.toBe(false);

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      'http://worker.test/health',
      expect.objectContaining({
        method: 'GET',
        signal: expect.any(AbortSignal),
      }),
    );
  });
});

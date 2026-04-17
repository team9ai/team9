import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockCaptureException = jest.fn();

jest.unstable_mockModule('@sentry/nestjs', () => ({
  captureException: mockCaptureException,
}));

const { HttpException, Logger } = await import('@nestjs/common');
const { BaseExceptionFilter } = await import('@nestjs/core');
const { CustomSentryFilter } = await import('./sentry-global.filter.js');

describe('CustomSentryFilter (gateway)', () => {
  const host = {} as Parameters<CustomSentryFilter['catch']>[1];
  const baseCatchSpy = jest.spyOn(BaseExceptionFilter.prototype, 'catch');
  const loggerErrorSpy = jest
    .spyOn(Logger.prototype, 'error')
    .mockImplementation(() => undefined);

  beforeEach(() => {
    jest.clearAllMocks();
    baseCatchSpy.mockReturnValue('handled' as never);
    loggerErrorSpy.mockImplementation(() => undefined);
  });

  it('logs a readable message and stack for unknown errors so OtelLogger does not mangle the body', () => {
    const filter = new CustomSentryFilter();
    const exception = new Error('db connection refused');
    exception.stack = 'Error: db connection refused\n    at foo (bar.ts:1)';

    filter.catch(exception, host);

    expect(loggerErrorSpy).toHaveBeenCalledWith(
      'Error: db connection refused',
      'Error: db connection refused\n    at foo (bar.ts:1)',
    );
    expect(mockCaptureException).toHaveBeenCalledWith(
      exception,
      expect.objectContaining({
        mechanism: {
          handled: false,
          type: 'auto.http.nestjs.global_filter',
        },
      }),
    );
    expect(baseCatchSpy).toHaveBeenCalledWith(exception, host);
  });

  it('logs the message for non-Error throws (e.g. string rejections)', () => {
    const filter = new CustomSentryFilter();

    filter.catch('something went wrong', host);

    expect(loggerErrorSpy).toHaveBeenCalledWith(
      'Unknown: something went wrong',
      undefined,
    );
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
  });

  it('skips logging and Sentry reporting for expected 4xx HttpExceptions', () => {
    const filter = new CustomSentryFilter();
    const exception = new HttpException('not found', 404);

    filter.catch(exception, host);

    expect(loggerErrorSpy).not.toHaveBeenCalled();
    expect(mockCaptureException).not.toHaveBeenCalled();
    expect(baseCatchSpy).toHaveBeenCalledWith(exception, host);
  });

  it('still logs and reports 5xx HttpExceptions', () => {
    const filter = new CustomSentryFilter();
    const exception = new HttpException('bad gateway', 502);

    filter.catch(exception, host);

    expect(loggerErrorSpy).toHaveBeenCalled();
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
  });

  it('delegates to BaseExceptionFilter after its own logging', () => {
    const filter = new CustomSentryFilter();
    const exception = new Error('boom');

    const result = filter.catch(exception, host);

    expect(baseCatchSpy).toHaveBeenCalledWith(exception, host);
    expect(result).toBe('handled');
  });
});

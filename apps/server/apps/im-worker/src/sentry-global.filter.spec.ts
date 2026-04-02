import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockCaptureException = jest.fn();

jest.unstable_mockModule('@sentry/nestjs', () => ({
  captureException: mockCaptureException,
}));

const { HttpException } = await import('@nestjs/common');
const { BaseExceptionFilter } = await import('@nestjs/core');
const { CustomSentryFilter } = await import('./sentry-global.filter.js');

describe('CustomSentryFilter', () => {
  const host = {} as Parameters<CustomSentryFilter['catch']>[1];
  const baseCatchSpy = jest.spyOn(BaseExceptionFilter.prototype, 'catch');

  beforeEach(() => {
    jest.clearAllMocks();
    baseCatchSpy.mockReturnValue('handled' as never);
  });

  it('reports non-http exceptions to Sentry before delegating to BaseExceptionFilter', () => {
    const filter = new CustomSentryFilter();
    const exception = new Error('boom');

    const result = filter.catch(exception, host);

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
    expect(result).toBe('handled');
  });

  it('skips Sentry reporting for expected 4xx HttpExceptions', () => {
    const filter = new CustomSentryFilter();
    const exception = new HttpException('bad request', 400);

    filter.catch(exception, host);

    expect(mockCaptureException).not.toHaveBeenCalled();
    expect(baseCatchSpy).toHaveBeenCalledWith(exception, host);
  });

  it('still reports 5xx HttpExceptions', () => {
    const filter = new CustomSentryFilter();
    const exception = new HttpException('server error', 500);

    filter.catch(exception, host);

    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    expect(baseCatchSpy).toHaveBeenCalledWith(exception, host);
  });
});

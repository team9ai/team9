import { ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import * as Sentry from '@sentry/nestjs';

/**
 * Custom exception filter that replaces @sentry/nestjs's SentryGlobalFilter.
 *
 * The default SentryGlobalFilter uses `isExpectedError` which skips reporting
 * for ANY exception that has a `status` or `error` property. This causes
 * database errors (which have an `error` property from the pg driver) to be
 * silently swallowed.
 *
 * This filter only skips Sentry reporting for HttpExceptions with status < 500,
 * which are expected business errors (400, 401, 403, 404, etc.).
 * Everything else — including DB errors, 5xx HttpExceptions, and runtime
 * errors — gets reported.
 */
@Catch()
export class CustomSentryFilter extends BaseExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const isExpectedHttpError =
      exception instanceof HttpException && exception.getStatus() < 500;

    if (!isExpectedHttpError) {
      Sentry.captureException(exception, {
        mechanism: {
          handled: false,
          type: 'auto.http.nestjs.global_filter',
        },
      });
    }

    return super.catch(exception, host);
  }
}

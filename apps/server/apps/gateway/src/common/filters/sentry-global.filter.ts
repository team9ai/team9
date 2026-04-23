import { ArgumentsHost, Catch, HttpException, Logger } from '@nestjs/common';
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
 *
 * We also explicitly log the error message + stack here. NestJS's
 * BaseExceptionFilter passes the raw exception object to `logger.error()`,
 * which OtelLogger coerces to a `[object Object]` body — the stack is lost.
 * Logging a string message with the stack as the second arg gives the
 * OtelLogger a usable body + trace attribute.
 */
@Catch()
export class CustomSentryFilter extends BaseExceptionFilter {
  private readonly errorLogger = new Logger('UnhandledException');

  catch(exception: unknown, host: ArgumentsHost) {
    const isExpectedHttpError =
      exception instanceof HttpException && exception.getStatus() < 500;

    if (!isExpectedHttpError) {
      const message =
        exception instanceof Error ? exception.message : String(exception);
      const stack = exception instanceof Error ? exception.stack : undefined;
      const name =
        exception instanceof Error ? exception.constructor.name : 'Unknown';
      this.errorLogger.error(`${name}: ${message}`, stack);

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

import { LoggerService, LogLevel } from '@nestjs/common';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';

export class OtelLogger implements LoggerService {
  private readonly logger = logs.getLogger('nestjs');

  log(message: string, context?: string): void {
    this.logger.emit({
      severityNumber: SeverityNumber.INFO,
      severityText: 'INFO',
      body: message,
      attributes: context ? { context } : undefined,
    });
    console.log(`[${context ?? 'App'}] ${message}`);
  }

  error(message: string, trace?: string, context?: string): void {
    this.logger.emit({
      severityNumber: SeverityNumber.ERROR,
      severityText: 'ERROR',
      body: message,
      attributes: {
        ...(context ? { context } : {}),
        ...(trace ? { 'exception.stacktrace': trace } : {}),
      },
    });
    console.error(`[${context ?? 'App'}] ${message}`, trace ?? '');
  }

  warn(message: string, context?: string): void {
    this.logger.emit({
      severityNumber: SeverityNumber.WARN,
      severityText: 'WARN',
      body: message,
      attributes: context ? { context } : undefined,
    });
    console.warn(`[${context ?? 'App'}] ${message}`);
  }

  debug(message: string, context?: string): void {
    this.logger.emit({
      severityNumber: SeverityNumber.DEBUG,
      severityText: 'DEBUG',
      body: message,
      attributes: context ? { context } : undefined,
    });
  }

  verbose(message: string, context?: string): void {
    this.logger.emit({
      severityNumber: SeverityNumber.TRACE,
      severityText: 'TRACE',
      body: message,
      attributes: context ? { context } : undefined,
    });
  }

  setLogLevels(_levels: LogLevel[]): void {
    // OTel handles log levels at the collector/backend level
  }
}

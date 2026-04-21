export interface BootstrapRetryLogger {
  warn: (message: string) => void;
}

export interface BootstrapRetryOptions {
  /** Max total attempts (including the first try). Defaults to 10. */
  maxAttempts?: number;
  /** Base backoff in ms for the first retry. Defaults to 1000 (1s). */
  baseMs?: number;
  /** Max backoff cap in ms per retry. Defaults to 15000 (15s). */
  maxMs?: number;
  /** Logger used for retry warnings. No-op if omitted. */
  logger?: BootstrapRetryLogger;
  /** Injected sleep, exposed for tests. Defaults to setTimeout-based. */
  sleep?: (ms: number) => Promise<void>;
}

// Postgres error code 42P01 = undefined_table. Surfaces when a worker boots
// before the gateway-run migrations have created the relation it queries.
const UNDEFINED_RELATION_CODE = '42P01';

function isUndefinedRelationError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const { code, cause } = err as { code?: unknown; cause?: unknown };
  if (code === UNDEFINED_RELATION_CODE) return true;
  if (cause && typeof cause === 'object') {
    const causeCode = (cause as { code?: unknown }).code;
    if (causeCode === UNDEFINED_RELATION_CODE) return true;
  }
  return false;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry an entire worker bootstrap when it fails because the DB schema is not
 * ready yet (Postgres `42P01` — undefined relation). Covers the race where a
 * worker starts in parallel with the gateway that owns migrations.
 *
 * The caller's `bootstrap` must be self-contained: clean up partially-created
 * resources (e.g. close a Nest app) before rethrowing, because every attempt
 * starts from scratch.
 *
 * Non-42P01 failures propagate immediately so genuine bugs stay visible.
 */
export async function bootstrapWithSchemaRetry(
  bootstrap: () => Promise<void>,
  options: BootstrapRetryOptions = {},
): Promise<void> {
  const max = options.maxAttempts ?? 10;
  const base = options.baseMs ?? 1000;
  const cap = options.maxMs ?? 15000;
  const sleep = options.sleep ?? defaultSleep;
  const logger = options.logger;

  for (let attempt = 1; attempt <= max; attempt++) {
    try {
      await bootstrap();
      return;
    } catch (err) {
      const isLast = attempt === max;
      if (!isUndefinedRelationError(err) || isLast) {
        throw err;
      }
      const delay = Math.min(cap, base * 2 ** (attempt - 1));
      logger?.warn(
        `bootstrap failed because DB schema is not ready yet; retrying in ${delay}ms (attempt ${attempt}/${max})`,
      );
      await sleep(delay);
    }
  }
}

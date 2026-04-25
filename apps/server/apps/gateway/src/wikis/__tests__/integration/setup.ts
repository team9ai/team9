/**
 * Helpers for the folder9 integration spec. Kept in a separate module so the
 * spec itself stays readable and so these utilities can be reused if we add
 * a second integration suite.
 *
 * Docker orchestration: we intentionally do NOT auto-start / auto-stop
 * `docker compose` from inside the test. Test runners have unpredictable
 * shutdown semantics (aborting Jest kills the process mid-teardown) which
 * would leak containers. Instead the README documents
 * `docker compose up -d` / `docker compose down -v` as a precondition, and
 * the helpers below just wait for folder9 to be reachable.
 */
import { jest } from '@jest/globals';

/**
 * Poll folder9's /healthz endpoint until it returns 2xx. Folds all transient
 * failures (ECONNREFUSED, 5xx, fetch throws) into a "not ready yet" signal so
 * the caller only has to await one promise.
 *
 * @param baseUrl - folder9 base URL (e.g. "http://localhost:58080")
 * @param timeoutMs - hard deadline in ms; rejects if exceeded. Defaults to 60s
 *                    since a cold `docker compose up` can take ~30s before
 *                    folder9 finishes booting + running migrations.
 * @param intervalMs - delay between attempts. Short enough that a warm start
 *                     finishes within the first couple of loops.
 */
export async function waitForFolder9Health(
  baseUrl: string,
  timeoutMs = 60_000,
  intervalMs = 500,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  for (;;) {
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/healthz`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (res.ok) return;
      lastError = new Error(`healthz returned ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    if (Date.now() >= deadline) {
      const message =
        lastError instanceof Error ? lastError.message : String(lastError);
      throw new Error(
        `folder9 at ${baseUrl} did not become healthy within ${timeoutMs}ms (last error: ${message})`,
      );
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/**
 * Build a fluent Drizzle chain mock — same shape used by the unit suites.
 * Terminal methods (`limit`, `returning`, `orderBy`) resolve to `[]` by
 * default; tests stack `mockResolvedValueOnce` calls to simulate row lookups.
 *
 * Duplicated here (not imported from wikis.service.spec.ts) because that
 * file defines it as a local `function mockDb()` without an export — copying
 * the 20-line helper is cheaper than cross-spec coupling.
 */
export type ChainMock = Record<string, jest.Mock> & {
  select: jest.Mock;
  from: jest.Mock;
  where: jest.Mock;
  limit: jest.Mock;
  returning: jest.Mock;
  orderBy: jest.Mock;
  insert: jest.Mock;
  values: jest.Mock;
  update: jest.Mock;
  set: jest.Mock;
  delete: jest.Mock;
};

export function makeChainMock(): ChainMock {
  const chain: Record<string, jest.Mock> = {};
  const methods = [
    'select',
    'from',
    'where',
    'and',
    'eq',
    'insert',
    'values',
    'returning',
    'update',
    'set',
    'delete',
    'orderBy',
    'limit',
  ];
  for (const m of methods) {
    chain[m] = jest.fn().mockReturnValue(chain);
  }
  chain.limit.mockResolvedValue([]);
  chain.returning.mockResolvedValue([]);
  chain.orderBy.mockResolvedValue([]);
  return chain as ChainMock;
}

/**
 * Periodic sampler for the `routines.folder_id_null_total` gauge.
 *
 * # Why a sampler, not a callback gauge
 *
 * OpenTelemetry's `UpDownCounter` is a delta-style instrument — every
 * increment/decrement is added to the running total inside the SDK. We
 * want the total to *equal* the actual NULL-folder row count at sample
 * time, not the cumulative sum of every sample we've ever emitted.
 *
 * To bridge the two, the sampler tracks the value applied on the previous
 * tick (`lastSampledValue`) and emits the *delta* on each new tick. The
 * exporter sees a smooth running total that matches the DB at every
 * collection window, regardless of how often the collector scrapes.
 *
 * If we used `ObservableGauge.addCallback`, the SDK would re-invoke the
 * callback on every collection; the SDK already exists in this repo via
 * `@opentelemetry/sdk-metrics`, but the rest of `appMetrics` uses lazy
 * sync instruments and the callback-driven flavour requires meter-level
 * registration that doesn't fit the "lazy getter" shape we already have.
 * Sticking with the same pattern keeps the metrics module minimal.
 *
 * # Cost control
 *
 * On a workspace with N routines the COUNT(*) FILTER (...) query touches
 * an indexed column. To bound worst-case cost on installations where the
 * routines table grows large before the migration completes, the sampler
 * scopes its scan to the first `MAX_SCAN_ROWS` ids returned by an inner
 * SELECT. This is a deliberate trade-off: dashboards see "≤ 10000 NULL
 * folder rows" rather than the true count, but the goal of the metric is
 * "is the migration making progress, or stuck" — both are answered by a
 * decreasing curve. The scoping comment is kept inline so future
 * maintainers know to lift the cap if the migration ever ramps to that
 * number.
 *
 * # Lifecycle
 *
 * - `onModuleInit` schedules the first run on a `setInterval` timer.
 *   Pattern matches `ZombieCleanerService` so reviewers don't need to
 *   parse a new lifecycle.
 * - `onModuleDestroy` clears the timer. NestJS calls this on graceful
 *   shutdown; any in-flight tick is allowed to complete (no abort
 *   plumbing) — the worst case is one unnecessary DB query at SIGTERM.
 *
 * Tests inject a fake `db` and replace `appMetrics.routinesFolderIdNullTotal`
 * via `jest.spyOn` to observe the delta-emitting behaviour without an
 * OTEL pipeline.
 */

import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  DATABASE_CONNECTION,
  sql,
  type PostgresJsDatabase,
} from '@team9/database';
import type * as schema from '@team9/database/schemas';
import { appMetrics } from '@team9/observability';

/**
 * Default sampling cadence. 60s aligns with the spec ("sampled
 * per-minute"), and matches the typical Prometheus scrape interval — any
 * shorter and back-to-back scrapes would see the same value.
 */
export const DEFAULT_SAMPLE_INTERVAL_MS = 60_000;

/**
 * Cap on the number of rows the COUNT scan touches. Comment in the file
 * header explains the trade-off; the constant is exported so unit tests
 * can shrink it for fast assertions.
 */
export const MAX_SCAN_ROWS = 10_000;

@Injectable()
export class RoutinesFolderIdNullSampler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(RoutinesFolderIdNullSampler.name);

  private intervalHandle: NodeJS.Timeout | null = null;

  /**
   * Last value applied to the UpDownCounter. Used to compute the delta
   * on the next tick — see file header. Initialized to 0 so the first
   * tick emits the current count as a positive delta against the
   * "starting from zero" assumption.
   */
  private lastSampledValue = 0;

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  onModuleInit(): void {
    // Run one immediate sample so the metric isn't stuck at 0 for the
    // first interval-window after process start. `void` because the
    // promise resolves asynchronously and we don't want to block init.
    void this.sample();
    this.intervalHandle = setInterval(() => {
      void this.sample();
    }, DEFAULT_SAMPLE_INTERVAL_MS);
    this.logger.log(
      `routines.folder_id_null_total sampler started (interval: ${DEFAULT_SAMPLE_INTERVAL_MS}ms)`,
    );
  }

  onModuleDestroy(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    this.logger.log('routines.folder_id_null_total sampler stopped');
  }

  /**
   * Run one sample: COUNT NULL-folder rows up to MAX_SCAN_ROWS, compute
   * the delta against the last reading, and emit it.
   *
   * Public so tests can drive the sampler deterministically without
   * waiting for the timer.
   */
  async sample(): Promise<void> {
    try {
      // Inner SELECT scopes the scan to MAX_SCAN_ROWS NULL-folder ids;
      // outer COUNT(*) tallies the survivors. On a table smaller than
      // the cap this returns the true count; once the cap is hit the
      // sampler reports MAX_SCAN_ROWS and the dashboard plateau is the
      // signal "still need to backfill, can't tell exact count" — which
      // is the right operational answer (decide whether the migration
      // is making progress, not litigate the exact remainder).
      const rows = (await this.db.execute(
        sql`SELECT COUNT(*)::int AS count FROM (
          SELECT id FROM routine__routines
          WHERE folder_id IS NULL
          LIMIT ${MAX_SCAN_ROWS}
        ) AS scoped`,
      )) as Array<{ count: number }>;

      const current = rows[0]?.count ?? 0;
      const delta = current - this.lastSampledValue;
      if (delta !== 0) {
        appMetrics.routinesFolderIdNullTotal.add(delta);
      }
      this.lastSampledValue = current;
    } catch (err) {
      // Sampling is observability-only; never let a failure here take
      // down the gateway. Log and skip — the next tick retries.
      this.logger.warn(
        `routines.folder_id_null_total sample failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}

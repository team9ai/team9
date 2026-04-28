import {
  metrics,
  type Counter,
  type Histogram,
  type UpDownCounter,
} from '@opentelemetry/api';

const METER_NAME = 'team9';

let _meter: ReturnType<typeof metrics.getMeter> | null = null;

function getMeter() {
  if (!_meter) {
    _meter = metrics.getMeter(METER_NAME);
  }
  return _meter;
}

// Lazy-initialized metric instances
let _wsConnections: UpDownCounter | null = null;
let _messagesTotal: Counter | null = null;
let _messageLatency: Histogram | null = null;
let _onlineUsers: UpDownCounter | null = null;
let _hiveSendFailures: Counter | null = null;
let _routinesFolderIdNullTotal: UpDownCounter | null = null;
let _routinesLazyProvisionTotal: Counter | null = null;
let _routinesLazyProvisionDurationMs: Histogram | null = null;
let _routinesCreateFolder9FailureTotal: Counter | null = null;
let _routinesCompleteCreationValidationFailureTotal: Counter | null = null;

export const appMetrics = {
  get wsConnections(): UpDownCounter {
    if (!_wsConnections) {
      _wsConnections = getMeter().createUpDownCounter('ws.connections', {
        description: 'Active WebSocket connections',
      });
    }
    return _wsConnections;
  },

  get messagesTotal(): Counter {
    if (!_messagesTotal) {
      _messagesTotal = getMeter().createCounter('im.messages.total', {
        description: 'Total messages processed',
      });
    }
    return _messagesTotal;
  },

  get messageLatency(): Histogram {
    if (!_messageLatency) {
      _messageLatency = getMeter().createHistogram('im.messages.duration_ms', {
        description: 'Message processing latency in milliseconds',
        unit: 'ms',
      });
    }
    return _messageLatency;
  },

  get onlineUsers(): UpDownCounter {
    if (!_onlineUsers) {
      _onlineUsers = getMeter().createUpDownCounter('users.online', {
        description: 'Currently online users',
      });
    }
    return _onlineUsers;
  },

  /**
   * Counts failures of `ClawHiveService.sendInput` from the im-worker
   * fan-out path. The call is fire-and-forget against the outbox
   * (markOutboxCompleted runs before the failure resolves), so this
   * counter is the primary signal that hive delivery is degraded;
   * pair it with the `im_hive_send_failures` DLQ table for replay.
   *
   * Recommended attributes when incrementing:
   *   - `error_kind`: one of `no_workers`, `timeout`, `http_error`, `other`
   *   - `tenant_id`: workspace tenant (when known)
   *   - `agent_id`: claw-hive agent identifier
   */
  get hiveSendFailures(): Counter {
    if (!_hiveSendFailures) {
      _hiveSendFailures = getMeter().createCounter('im.hive.send_failures', {
        description:
          'ClawHiveService.sendInput failures from the im-worker fan-out',
      });
    }
    return _hiveSendFailures;
  },

  // ── Routine → folder9 migration metrics (gateway routines.* paths) ──
  //
  // The five metrics below back §10.8 of the routine-skill-folder design
  // doc. They observe the rollout of the lazy folder provision invariant
  // (Layer 2) and the SKILL.md validation gate added by `completeCreation`.
  //
  // Alert wiring is not configured here — that lives in the deployment
  // infra (Grafana/Mimir alert rules). This module only emits the data.

  /**
   * Active count of routine rows whose `folder_id` column is still NULL.
   *
   * Sampled periodically by `RoutinesFolderIdNullSampler`
   * (apps/gateway/src/routines/metrics/routines-folder-id-null.sampler.ts).
   * The sampler resets to the latest count via `add(delta)` against an
   * internally tracked previous reading — OpenTelemetry's
   * `UpDownCounter` is a delta-style instrument, so the sampler must
   * compute and apply the delta itself.
   *
   * Expected behaviour post-rollout: monotonically decreases toward 0 as
   * lazy-provision and the offline backfill pick off any remaining
   * legacy rows. A persistent non-zero value with no decline is the
   * dashboard signal that the migration has stalled.
   */
  get routinesFolderIdNullTotal(): UpDownCounter {
    if (!_routinesFolderIdNullTotal) {
      _routinesFolderIdNullTotal = getMeter().createUpDownCounter(
        'routines.folder_id_null_total',
        {
          description:
            'Count of routines rows where folder_id IS NULL — sampled periodically; should decrease post-rollout',
        },
      );
    }
    return _routinesFolderIdNullTotal;
  },

  /**
   * Counter of `ensureRoutineFolder` slow-path completions.
   *
   * Incremented EXACTLY ONCE per slow-path traversal:
   *   - `result=ok` when the provision call returned and the UPDATE persisted.
   *   - `result=fail` when the provision call threw (we re-raise as 503;
   *     the DB transaction rolls back, so folder_id stays NULL and the
   *     next caller will retry — the next retry that succeeds will fire
   *     a fresh `result=ok` increment).
   *
   * Fast-path completions (folderId already set) DO NOT increment — this
   * counter is the Layer 2 trigger frequency, not a request rate.
   */
  get routinesLazyProvisionTotal(): Counter {
    if (!_routinesLazyProvisionTotal) {
      _routinesLazyProvisionTotal = getMeter().createCounter(
        'routines.lazy_provision_total',
        {
          description:
            'ensureRoutineFolder slow-path completions (lazy folder9 provision); labeled by result',
        },
      );
    }
    return _routinesLazyProvisionTotal;
  },

  /**
   * Latency of the `ensureRoutineFolder` slow path in milliseconds.
   *
   * Recorded once per slow-path traversal whether it succeeds OR fails —
   * the timer wraps both branches so dashboard p95 graphs see fail-mode
   * latency too (folder9 timeout is the most common slow case). The
   * companion counter's `result` label tells operators which bucket each
   * sample lived in.
   *
   * Fast-path traversals are NOT recorded — they would flatten the
   * histogram with sub-millisecond samples and obscure the slow-path
   * tail.
   */
  get routinesLazyProvisionDurationMs(): Histogram {
    if (!_routinesLazyProvisionDurationMs) {
      _routinesLazyProvisionDurationMs = getMeter().createHistogram(
        'routines.lazy_provision.duration_ms',
        {
          description:
            'Latency of ensureRoutineFolder slow path (lazy folder9 provision)',
          unit: 'ms',
        },
      );
    }
    return _routinesLazyProvisionDurationMs;
  },

  /**
   * Counter of atomic `RoutinesService.create` failures attributable to
   * folder9 (createFolder / createToken / commit / underlying network).
   *
   * Incremented in the `catch` block immediately before re-throwing as
   * `ServiceUnavailableException`. Pair with the request-rate counter
   * (alert: 5-min rate > 1% pages on-call). The DB transaction rolls
   * back when this fires, so no half-baked routine row leaks.
   *
   * The single increment per failure means the alert math is "per 503
   * response" and matches the user-visible failure shape.
   */
  get routinesCreateFolder9FailureTotal(): Counter {
    if (!_routinesCreateFolder9FailureTotal) {
      _routinesCreateFolder9FailureTotal = getMeter().createCounter(
        'routines.create.folder9_failure_total',
        {
          description:
            'RoutinesService.create folder9 provisioning failures (rolled back, surfaced as 503)',
        },
      );
    }
    return _routinesCreateFolder9FailureTotal;
  },

  /**
   * Counter of `completeCreation` SKILL.md validation rejections, labeled
   * by `rule` — one of the stable rule codes returned by
   * `validateSkillMd` (e.g. `name_mismatch`, `description_mismatch`,
   * `body_too_short`, `frontmatter_missing`, ...).
   *
   * Surfaces agent SKILL.md mistakes so the model team can shape better
   * prompts when one rule trips disproportionately often.
   *
   * The legacy required-field gate (`title is required` etc) above the
   * SKILL.md check does NOT increment this counter — those are caller
   * mistakes (the routine never had the data), not agent SKILL.md
   * mistakes, and they're already gated by API-level validation.
   */
  get routinesCompleteCreationValidationFailureTotal(): Counter {
    if (!_routinesCompleteCreationValidationFailureTotal) {
      _routinesCompleteCreationValidationFailureTotal =
        getMeter().createCounter(
          'routines.complete_creation.validation_failure_total',
          {
            description:
              'SKILL.md validation rejections from completeCreation, labeled by failed rule',
          },
        );
    }
    return _routinesCompleteCreationValidationFailureTotal;
  },
};

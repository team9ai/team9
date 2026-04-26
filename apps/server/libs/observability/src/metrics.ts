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
};

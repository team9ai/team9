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
};

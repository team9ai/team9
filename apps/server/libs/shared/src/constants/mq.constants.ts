/**
 * RabbitMQ Exchange definitions for distributed IM architecture
 */
export const MQ_EXCHANGES = {
  // Topic exchange for downstream messages (Logic -> Gateway)
  IM_TOPIC: 'im.exchange.topic',

  // Direct exchange for upstream messages (Gateway -> Logic)
  IM_UPSTREAM: 'im.exchange.upstream',

  // Dead letter exchange for failed messages
  IM_DLX: 'im.exchange.dlx',

  // Fanout exchange for broadcast messages (e.g., large group messages)
  IM_BROADCAST: 'im.exchange.broadcast',
} as const;

/**
 * RabbitMQ Queue definitions
 */
export const MQ_QUEUES = {
  // Gateway node queue (dynamically created per node)
  GATEWAY: (nodeId: string) => `im.queue.gateway.${nodeId}`,

  // Logic Service upstream queue (consumes all upstream messages)
  LOGIC_UPSTREAM: 'im.queue.logic.upstream',

  // Post-broadcast task queue (handles offline messages + unread counts)
  POST_BROADCAST: 'im.queue.post_broadcast',

  // ACK processing queue
  ACK_QUEUE: 'im.queue.ack',

  // Dead letter queue
  DLQ: 'im.queue.dlq',
} as const;

/**
 * RabbitMQ Routing Key definitions
 */
export const MQ_ROUTING_KEYS = {
  // Route to specific Gateway node
  TO_GATEWAY: (nodeId: string) => `gateway.${nodeId}`,

  // Upstream message types
  UPSTREAM: {
    MESSAGE: 'upstream.message',
    ACK: 'upstream.ack',
    TYPING: 'upstream.typing',
    READ: 'upstream.read',
    PRESENCE: 'upstream.presence',
    // Post-broadcast task (handles offline messages + unread counts after Gateway broadcast)
    POST_BROADCAST: 'upstream.post_broadcast',
  },

  // Broadcast to all gateways
  BROADCAST: 'gateway.*',
} as const;

/**
 * Message delivery configuration
 */
export const MQ_CONFIG = {
  // Message TTL in gateway queue (60 seconds)
  GATEWAY_MESSAGE_TTL: 60000,

  // Max retry count for message delivery
  MAX_RETRY_COUNT: 3,

  // Retry delay in milliseconds
  RETRY_DELAY: 5000,

  // ACK timeout in milliseconds (10 seconds)
  ACK_TIMEOUT: 10000,

  // Offline message expiration (7 days)
  OFFLINE_MESSAGE_TTL: 7 * 24 * 60 * 60 * 1000,
} as const;

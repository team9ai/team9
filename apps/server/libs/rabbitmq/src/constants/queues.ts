export const RABBITMQ_EXCHANGES = {
  WORKSPACE_EVENTS: 'workspace.events',
  NOTIFICATION_EVENTS: 'notification.events',
  NOTIFICATION_DELIVERY: 'notification.delivery',
} as const;

export const RABBITMQ_QUEUES = {
  // Note: USER_OFFLINE_MESSAGES removed - now using SeqId-based incremental sync
  // Notification processing queue (consumed by im-worker)
  NOTIFICATION_TASKS: 'notification.tasks',
  // Notification delivery queue (consumed by Gateway for WebSocket push)
  NOTIFICATION_DELIVERY: 'notification.delivery',
} as const;

export const RABBITMQ_ROUTING_KEYS = {
  WORKSPACE_MEMBER_JOINED: 'workspace.member.joined',
  WORKSPACE_MEMBER_LEFT: 'workspace.member.left',
  USER_ONLINE: 'user.online',
  USER_OFFLINE: 'user.offline',
  // Notification routing keys (for im-worker processing)
  NOTIFICATION_MENTION: 'notification.mention',
  NOTIFICATION_REPLY: 'notification.reply',
  NOTIFICATION_DM: 'notification.dm',
  NOTIFICATION_WORKSPACE: 'notification.workspace',
  // Notification delivery routing keys (for Gateway WebSocket push)
  DELIVERY_NEW: 'delivery.new',
  DELIVERY_COUNTS: 'delivery.counts',
  DELIVERY_READ: 'delivery.read',
} as const;

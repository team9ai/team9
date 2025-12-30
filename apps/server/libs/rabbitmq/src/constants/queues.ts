export const RABBITMQ_EXCHANGES = {
  WORKSPACE_EVENTS: 'workspace.events',
} as const;

export const RABBITMQ_QUEUES = {
  // User offline message queue (one queue per user)
  USER_OFFLINE_MESSAGES: (userId: string) => `user.${userId}.offline_messages`,
} as const;

export const RABBITMQ_ROUTING_KEYS = {
  WORKSPACE_MEMBER_JOINED: 'workspace.member.joined',
  WORKSPACE_MEMBER_LEFT: 'workspace.member.left',
  USER_ONLINE: 'user.online',
  USER_OFFLINE: 'user.offline',
} as const;

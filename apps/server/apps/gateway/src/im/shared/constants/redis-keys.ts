export const REDIS_KEYS = {
  // User related
  ONLINE_USERS: 'im:online_users',
  USER_CACHE: (userId: string) => `im:user:${userId}`,
  USER_SOCKETS: (userId: string) => `im:user_sockets:${userId}`,

  // Socket mapping
  SOCKET_USER: (socketId: string) => `im:socket:${socketId}`,

  // Channel related
  CHANNEL_MEMBERS: (channelId: string) => `im:channel_members:${channelId}`,
  CHANNEL_TYPING: (channelId: string) => `im:typing:${channelId}`,

  // Message related
  RECENT_MESSAGES: (channelId: string) => `im:recent_messages:${channelId}`,
  MESSAGE_CACHE: (messageId: string) => `im:message:${messageId}`,

  // Session related
  REFRESH_TOKEN: (userId: string) => `im:refresh_token:${userId}`,
  USER_SESSIONS: (userId: string) => `im:sessions:${userId}`,

  // Workspace related
  WORKSPACE_MEMBERS: (workspaceId: string) =>
    `im:workspace_members:${workspaceId}`,
  USER_WORKSPACES: (userId: string) => `im:user_workspaces:${userId}`,
};

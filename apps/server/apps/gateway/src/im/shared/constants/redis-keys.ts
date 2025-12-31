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

  // ============ Distributed IM Architecture Keys ============

  // User route mapping - Hash: gatewayId, socketId, loginTime, lastActiveTime
  USER_ROUTE: (userId: string) => `im:route:user:${userId}`,

  // User multi-device sessions - Hash: socketId -> Session JSON
  USER_MULTI_SESSION: (userId: string) => `im:session:user:${userId}`,

  // Gateway node info - Hash: node properties
  GATEWAY_NODE: (nodeId: string) => `im:node:${nodeId}`,

  // Active gateway nodes - Set: all active node IDs
  GATEWAY_NODES: 'im:nodes',

  // Gateway connection counts - Sorted Set: nodeId -> connectionCount
  GATEWAY_CONNECTIONS: 'im:node_connections',

  // Heartbeat check - Sorted Set: {userId}:{socketId} -> lastHeartbeat timestamp
  HEARTBEAT_CHECK: 'im:heartbeat_check',

  // Message ACK status - Hash: userId -> ackStatus
  MESSAGE_ACK: (msgId: string) => `im:ack:${msgId}`,

  // Pending ACK messages - Sorted Set: msgId -> timestamp (for retry)
  PENDING_ACK: (userId: string) => `im:pending_ack:${userId}`,

  // Channel message sequence - String: current max SeqID
  CHANNEL_SEQ: (channelId: string) => `im:seq:channel:${channelId}`,

  // User message sequence (for DM) - String: current max SeqID
  USER_SEQ: (userId: string) => `im:seq:user:${userId}`,

  // Client message deduplication - Set with TTL
  MSG_DEDUP: (clientMsgId: string) => `im:dedup:${clientMsgId}`,
};

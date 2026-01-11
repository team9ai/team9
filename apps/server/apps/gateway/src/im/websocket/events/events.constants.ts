export const WS_EVENTS = {
  // Connection related
  CONNECTION: 'connection',
  DISCONNECT: 'disconnect',
  ERROR: 'error',

  // Authentication
  AUTHENTICATE: 'authenticate',
  AUTHENTICATED: 'authenticated',
  AUTH_ERROR: 'auth_error',

  // Channel
  JOIN_CHANNEL: 'join_channel',
  LEAVE_CHANNEL: 'leave_channel',
  CHANNEL_JOINED: 'channel_joined',
  CHANNEL_LEFT: 'channel_left',
  CHANNEL_CREATED: 'channel_created',
  CHANNEL_DELETED: 'channel_deleted',
  CHANNEL_ARCHIVED: 'channel_archived',
  CHANNEL_UNARCHIVED: 'channel_unarchived',
  CHANNEL_UPDATED: 'channel_updated',

  // Message
  SEND_MESSAGE: 'send_message',
  NEW_MESSAGE: 'new_message',
  MESSAGE_UPDATED: 'message_updated',
  MESSAGE_DELETED: 'message_deleted',

  // Read status
  MARK_AS_READ: 'mark_as_read',
  READ_STATUS_UPDATED: 'read_status_updated',

  // User status
  USER_ONLINE: 'user_online',
  USER_OFFLINE: 'user_offline',
  USER_STATUS_CHANGED: 'user_status_changed',

  // Typing status
  TYPING_START: 'typing_start',
  TYPING_STOP: 'typing_stop',
  USER_TYPING: 'user_typing',

  // Reactions
  ADD_REACTION: 'add_reaction',
  REMOVE_REACTION: 'remove_reaction',
  REACTION_ADDED: 'reaction_added',
  REACTION_REMOVED: 'reaction_removed',

  // Mentions
  MENTION_RECEIVED: 'mention_received',

  // Workspace member events
  WORKSPACE_MEMBER_JOINED: 'workspace_member_joined',
  WORKSPACE_MEMBER_LEFT: 'workspace_member_left',
  WORKSPACE_MEMBER_REMOVED: 'workspace_member_removed',
  JOIN_WORKSPACE: 'join_workspace',
  WORKSPACE_MEMBERS_LIST: 'workspace_members_list',

  // ============ Distributed IM Architecture Events ============

  // Heartbeat
  PING: 'ping',
  PONG: 'pong',

  // Message ACK
  MESSAGE_ACK: 'message_ack', // Client sends ACK
  MESSAGE_ACK_RESPONSE: 'message_ack_response', // Server confirms ACK
  MESSAGE_SENT: 'message_sent', // Server confirms message received (with seqId)

  // Session management
  SESSION_EXPIRED: 'session_expired', // Session no longer valid
  SESSION_TIMEOUT: 'session_timeout', // Heartbeat timeout
  SESSION_KICKED: 'session_kicked', // Kicked by another device

  // Message sync
  SYNC_MESSAGES: 'sync_messages', // Request to sync messages
  SYNC_MESSAGES_RESPONSE: 'sync_messages_response', // Sync response

  // Message retry
  MESSAGE_RETRY: 'message_retry', // Retry delivery
} as const;

export type WsEvent = (typeof WS_EVENTS)[keyof typeof WS_EVENTS];

/**
 * WebSocket Event Name Constants
 *
 * All WebSocket event names grouped by functional domain.
 * Using `as const` ensures type inference as literal types.
 *
 * @example
 * ```typescript
 * import { WS_EVENTS } from '@team9/shared';
 *
 * // Server side
 * client.emit(WS_EVENTS.AUTH.AUTHENTICATED, { userId });
 *
 * // Client side
 * socket.on(WS_EVENTS.MESSAGE.NEW, (message) => { ... });
 * ```
 */
export const WS_EVENTS = {
  // ==================== Connection ====================
  /**
   * Socket.io built-in connection events
   */
  CONNECTION: {
    /** Connection established */
    CONNECT: 'connection',
    /** Connection closed */
    DISCONNECT: 'disconnect',
    /** Connection error */
    ERROR: 'error',
  },

  // ==================== Authentication ====================
  /**
   * User authentication events
   */
  AUTH: {
    /** Authentication request - sent by client */
    AUTHENTICATE: 'authenticate',
    /** Authentication success - sent by server */
    AUTHENTICATED: 'authenticated',
    /** Authentication failure - sent by server */
    AUTH_ERROR: 'auth_error',
  },

  // ==================== Channel Operations ====================
  /**
   * Channel related events
   */
  CHANNEL: {
    /** Join channel - sent by client */
    JOIN: 'join_channel',
    /** Leave channel - sent by client */
    LEAVE: 'leave_channel',
    /** Channel joined - broadcast by server */
    JOINED: 'channel_joined',
    /** Channel left - broadcast by server */
    LEFT: 'channel_left',
    /** Channel created - broadcast by server */
    CREATED: 'channel_created',
    /** Channel updated - broadcast by server */
    UPDATED: 'channel_updated',
    /** Channel deleted - broadcast by server */
    DELETED: 'channel_deleted',
    /** Channel archived - broadcast by server */
    ARCHIVED: 'channel_archived',
    /** Channel unarchived - broadcast by server */
    UNARCHIVED: 'channel_unarchived',
  },

  // ==================== Message Operations ====================
  /**
   * Message related events
   */
  MESSAGE: {
    /** New message - broadcast by server */
    NEW: 'new_message',
    /** Message updated - broadcast by server */
    UPDATED: 'message_updated',
    /** Message deleted - broadcast by server */
    DELETED: 'message_deleted',
  },

  // ==================== Read Status ====================
  /**
   * Message read status events
   */
  READ_STATUS: {
    /** Mark as read - sent by client */
    MARK_AS_READ: 'mark_as_read',
    /** Read status updated - broadcast by server */
    UPDATED: 'read_status_updated',
  },

  // ==================== Typing Status ====================
  /**
   * Typing indicator events
   */
  TYPING: {
    /** Start typing - sent by client */
    START: 'typing_start',
    /** Stop typing - sent by client */
    STOP: 'typing_stop',
    /** User typing - broadcast by server */
    USER_TYPING: 'user_typing',
  },

  // ==================== User Status ====================
  /**
   * User online status events
   */
  USER: {
    /** User online - broadcast by server */
    ONLINE: 'user_online',
    /** User offline - broadcast by server */
    OFFLINE: 'user_offline',
    /** User status changed - broadcast by server */
    STATUS_CHANGED: 'user_status_changed',
  },

  // ==================== Message Reactions ====================
  /**
   * Message emoji reaction events
   */
  REACTION: {
    /** Add reaction - sent by client */
    ADD: 'add_reaction',
    /** Remove reaction - sent by client */
    REMOVE: 'remove_reaction',
    /** Reaction added - broadcast by server */
    ADDED: 'reaction_added',
    /** Reaction removed - broadcast by server */
    REMOVED: 'reaction_removed',
  },

  // ==================== Notification Center ====================
  /**
   * Unified notification center events
   */
  NOTIFICATION: {
    /** New notification received - sent by server */
    NEW: 'notification_new',
    /** Notification counts updated - sent by server */
    COUNTS_UPDATED: 'notification_counts_updated',
    /** Notifications marked as read - sent by server (for multi-device sync) */
    READ: 'notification_read',
  },

  // ==================== Workspace ====================
  /**
   * Workspace related events
   */
  WORKSPACE: {
    /** Join workspace - sent by client */
    JOIN: 'join_workspace',
    /** Workspace members list - sent by server */
    MEMBERS_LIST: 'workspace_members_list',
    /** Member joined - broadcast by server */
    MEMBER_JOINED: 'workspace_member_joined',
    /** Member left - broadcast by server */
    MEMBER_LEFT: 'workspace_member_left',
    /** Member removed - broadcast by server */
    MEMBER_REMOVED: 'workspace_member_removed',
  },

  // ==================== System Events ====================
  /**
   * Heartbeat and system events
   */
  SYSTEM: {
    /** Heartbeat request - sent by client */
    PING: 'ping',
    /** Heartbeat response - sent by server */
    PONG: 'pong',
    /** Message acknowledgment - sent by client */
    MESSAGE_ACK: 'message_ack',
    /** Message acknowledgment response - sent by server */
    MESSAGE_ACK_RESPONSE: 'message_ack_response',
    /** Message sent confirmation - sent by server */
    MESSAGE_SENT: 'message_sent',
  },

  // ==================== Session Management ====================
  /**
   * Session status events
   */
  SESSION: {
    /** Session expired */
    EXPIRED: 'session_expired',
    /** Session timeout */
    TIMEOUT: 'session_timeout',
    /** Kicked by another device */
    KICKED: 'session_kicked',
  },

  // ==================== Message Sync ====================
  /**
   * Offline message sync events
   */
  SYNC: {
    /** Request sync messages - sent by client */
    MESSAGES: 'sync_messages',
    /** Sync response - sent by server */
    MESSAGES_RESPONSE: 'sync_messages_response',
    /** Message retry - sent by server */
    MESSAGE_RETRY: 'message_retry',
  },
} as const;

/**
 * Union type of all WebSocket event names
 */
export type WsEventName =
  | (typeof WS_EVENTS.CONNECTION)[keyof typeof WS_EVENTS.CONNECTION]
  | (typeof WS_EVENTS.AUTH)[keyof typeof WS_EVENTS.AUTH]
  | (typeof WS_EVENTS.CHANNEL)[keyof typeof WS_EVENTS.CHANNEL]
  | (typeof WS_EVENTS.MESSAGE)[keyof typeof WS_EVENTS.MESSAGE]
  | (typeof WS_EVENTS.READ_STATUS)[keyof typeof WS_EVENTS.READ_STATUS]
  | (typeof WS_EVENTS.TYPING)[keyof typeof WS_EVENTS.TYPING]
  | (typeof WS_EVENTS.USER)[keyof typeof WS_EVENTS.USER]
  | (typeof WS_EVENTS.REACTION)[keyof typeof WS_EVENTS.REACTION]
  | (typeof WS_EVENTS.NOTIFICATION)[keyof typeof WS_EVENTS.NOTIFICATION]
  | (typeof WS_EVENTS.WORKSPACE)[keyof typeof WS_EVENTS.WORKSPACE]
  | (typeof WS_EVENTS.SYSTEM)[keyof typeof WS_EVENTS.SYSTEM]
  | (typeof WS_EVENTS.SESSION)[keyof typeof WS_EVENTS.SESSION]
  | (typeof WS_EVENTS.SYNC)[keyof typeof WS_EVENTS.SYNC];

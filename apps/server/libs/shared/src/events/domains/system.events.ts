/**
 * System related WebSocket event type definitions
 *
 * Includes heartbeat, message acknowledgment, session management, message sync and other system-level events.
 *
 * @module events/domains/system
 */

// ==================== Heartbeat Events ====================

/**
 * Ping request
 *
 * Sent periodically by the client to keep the connection alive and detect network status.
 *
 * @event ping
 * @direction Client -> Server
 *
 * @example
 * ```typescript
 * // Client - send heartbeat every 30 seconds
 * setInterval(() => {
 *   socket.emit('ping', { timestamp: Date.now() });
 * }, 30000);
 * ```
 */
export interface PingPayload {
  /** Client send timestamp (milliseconds) */
  timestamp: number;
}

/**
 * Pong response
 *
 * Returned by the server after receiving a ping request.
 *
 * @event pong
 * @direction Server -> Client
 *
 * @example
 * ```typescript
 * socket.on('pong', (event: PongEvent) => {
 *   const latency = Date.now() - event.timestamp;
 *   console.log(`Network latency: ${latency}ms`);
 * });
 * ```
 */
export interface PongEvent {
  /** Event type identifier */
  type: 'pong';
  /** Original client timestamp (echo) */
  timestamp: number;
  /** Server current timestamp */
  serverTime: number;
}

// ==================== Message Acknowledgment Events ====================

/**
 * Message acknowledgment type
 */
export type MessageAckType = 'delivered' | 'read';

/**
 * Message acknowledgment request
 *
 * Sent by the client to acknowledge message delivery or read status.
 * The server will forward the acknowledgment to the IM Worker service for processing.
 *
 * @event message_ack
 * @direction Client -> Server
 *
 * @example
 * ```typescript
 * // Client - after message renders to screen
 * socket.emit('message_ack', {
 *   msgId: 'message-uuid',
 *   ackType: 'delivered'
 * });
 *
 * // Client - after user views message
 * socket.emit('message_ack', {
 *   msgId: 'message-uuid',
 *   ackType: 'read'
 * });
 * ```
 */
export interface MessageAckPayload {
  /** Message ID */
  msgId: string;
  /** Acknowledgment type */
  ackType: MessageAckType;
}

/**
 * Message acknowledgment response
 *
 * Returned by the server after receiving message acknowledgment.
 *
 * @event message_ack_response
 * @direction Server -> Client
 *
 * @example
 * ```typescript
 * socket.on('message_ack_response', (event: MessageAckResponseEvent) => {
 *   console.log(`Message ${event.msgId} ack status: ${event.status}`);
 * });
 * ```
 */
export interface MessageAckResponseEvent {
  /** Message ID */
  msgId: string;
  /** Acknowledgment status */
  status: 'received' | 'error';
  /** Error message (when status is error) */
  error?: string;
}

/**
 * Message sent confirmation event
 *
 * Sent by the server to the sender after message is successfully persisted.
 * Includes server-assigned message sequence number.
 *
 * @event message_sent
 * @direction Server -> Sender
 *
 * @example
 * ```typescript
 * socket.on('message_sent', (event: MessageSentEvent) => {
 *   // Update local message status to sent
 *   updateMessageStatus(event.clientMsgId, 'sent', event.seqId);
 * });
 * ```
 */
export interface MessageSentEvent {
  /** Server-generated message ID */
  msgId: string;
  /** Client-generated message ID (for matching local message) */
  clientMsgId?: string;
  /** Message sequence number (for ordering) */
  seqId: string;
  /** Server timestamp */
  serverTime: number;
}

// ==================== Session Management Events ====================

/**
 * Session expired event
 *
 * Sent by the server when user's auth token expires.
 *
 * @event session_expired
 * @direction Server -> Client
 *
 * @example
 * ```typescript
 * socket.on('session_expired', (event: SessionExpiredEvent) => {
 *   // Clear local state
 *   clearAuthState();
 *   // Navigate to login page
 *   navigateToLogin(event.reason);
 * });
 * ```
 */
export interface SessionExpiredEvent {
  /** Expiration reason */
  reason: string;
  /** Expiration time */
  expiredAt?: string;
}

/**
 * Session timeout event
 *
 * Sent by the server when heartbeat timeout causes session invalidation.
 *
 * @event session_timeout
 * @direction Server -> Client
 *
 * @example
 * ```typescript
 * socket.on('session_timeout', (event: SessionTimeoutEvent) => {
 *   // Try to reconnect
 *   reconnect();
 * });
 * ```
 */
export interface SessionTimeoutEvent {
  /** Timeout reason */
  reason: string;
  /** Last active time */
  lastActiveAt?: string;
}

/**
 * Kicked by another device event
 *
 * Sent by the server when the same account logs in on another device, causing current device to be kicked.
 *
 * @event session_kicked
 * @direction Server -> Client
 *
 * @example
 * ```typescript
 * socket.on('session_kicked', (event: SessionKickedEvent) => {
 *   showAlert(`Your account logged in on another device (${event.newDeviceInfo?.platform})`);
 *   // Disconnect and navigate to login page
 *   disconnect();
 *   navigateToLogin();
 * });
 * ```
 */
export interface SessionKickedEvent {
  /** Kick reason */
  reason: string;
  /** New device info */
  newDeviceInfo?: {
    platform: string;
    version?: string;
  };
}

// ==================== Message Sync Events ====================

/**
 * Sync messages request
 *
 * Sent by the client to request syncing messages missed during offline period.
 *
 * @event sync_messages
 * @direction Client -> Server
 *
 * @example
 * ```typescript
 * // Client - after reconnecting
 * socket.emit('sync_messages', {
 *   channelId: 'channel-uuid',
 *   lastMessageId: 'last-known-message-uuid',
 *   limit: 50
 * });
 * ```
 */
export interface SyncMessagesPayload {
  /** Channel ID (optional, sync all channels if not specified) */
  channelId?: string;
  /** Last known message ID (sync starts after this message) */
  lastMessageId?: string;
  /** Maximum number of messages to sync */
  limit?: number;
}

/**
 * Sync messages response
 *
 * Returns the requested offline messages.
 *
 * @event sync_messages_response
 * @direction Server -> Client
 *
 * @example
 * ```typescript
 * socket.on('sync_messages_response', (event: SyncMessagesResponseEvent) => {
 *   // Add synced messages to local storage
 *   for (const msg of event.messages) {
 *     addMessage(msg);
 *   }
 *   // If there are more messages, continue syncing
 *   if (event.hasMore) {
 *     requestMoreMessages(event.channelId, event.messages.at(-1)?.id);
 *   }
 * });
 * ```
 */
export interface SyncMessagesResponseEvent {
  /** Channel ID */
  channelId?: string;
  /** Synced message list */
  messages: Array<{
    id: string;
    channelId: string;
    senderId: string;
    content: string;
    type: string;
    createdAt: string;
    [key: string]: unknown;
  }>;
  /** Whether there are more messages */
  hasMore: boolean;
}

/**
 * Message retry event
 *
 * Sent by the server when message delivery fails, requesting client to retry.
 *
 * @event message_retry
 * @direction Server -> Client
 *
 * @example
 * ```typescript
 * socket.on('message_retry', (event: MessageRetryEvent) => {
 *   // Find local pending message
 *   const pendingMessage = getPendingMessage(event.clientMsgId);
 *   if (pendingMessage) {
 *     // Resend
 *     resendMessage(pendingMessage);
 *   }
 * });
 * ```
 */
export interface MessageRetryEvent {
  /** Client message ID */
  clientMsgId: string;
  /** Retry reason */
  reason: string;
  /** Current retry count */
  retryCount: number;
  /** Maximum retries */
  maxRetries: number;
}

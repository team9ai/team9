/**
 * Typing status related WebSocket event type definitions
 *
 * @module events/domains/typing
 */

// ==================== Client -> Server ====================

/**
 * Typing start request
 *
 * Sent by the client to notify other users that the current user is typing.
 * The server will set a typing status with 5-second TTL in Redis.
 *
 * @event typing_start
 * @direction Client -> Server
 *
 * @example
 * ```typescript
 * // Client - when user starts typing
 * socket.emit('typing_start', { channelId: 'channel-uuid' });
 * ```
 */
export interface TypingStartPayload {
  /** Channel ID where user is typing */
  channelId: string;
}

/**
 * Typing stop request
 *
 * Sent by the client to notify other users that the current user stopped typing.
 *
 * @event typing_stop
 * @direction Client -> Server
 *
 * @example
 * ```typescript
 * // Client - when user stops typing or sends message
 * socket.emit('typing_stop', { channelId: 'channel-uuid' });
 * ```
 */
export interface TypingStopPayload {
  /** Channel ID where user stopped typing */
  channelId: string;
}

// ==================== Server -> Client ====================

/**
 * User typing event
 *
 * Broadcast by the server to other channel members when a user starts or stops typing.
 *
 * @event user_typing
 * @direction Server -> Channel Members (excluding sender)
 *
 * @example
 * ```typescript
 * socket.on('user_typing', (event: UserTypingEvent) => {
 *   if (event.isTyping) {
 *     // Show "xxx is typing..."
 *     showTypingIndicator(event.channelId, event.username);
 *   } else {
 *     // Hide typing indicator
 *     hideTypingIndicator(event.channelId, event.userId);
 *   }
 * });
 * ```
 */
export interface UserTypingEvent {
  /** Channel ID */
  channelId: string;
  /** Typing user ID */
  userId: string;
  /** Typing username */
  username: string;
  /** Whether currently typing */
  isTyping: boolean;
}

// ==================== Response Types ====================

/**
 * Typing status operation response
 */
export interface TypingOperationResponse {
  /** Whether operation succeeded */
  success: boolean;
}

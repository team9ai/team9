/**
 * Message reaction related WebSocket event type definitions
 *
 * @module events/domains/reaction
 */

// ==================== Client -> Server ====================

/**
 * Add reaction request
 *
 * Sent by the client to add an emoji reaction to a message.
 *
 * @event add_reaction
 * @direction Client -> Server
 *
 * @example
 * ```typescript
 * // Client - user clicks emoji
 * socket.emit('add_reaction', {
 *   messageId: 'message-uuid',
 *   emoji: '👍'
 * });
 * ```
 */
export interface AddReactionPayload {
  /** Message ID */
  messageId: string;
  /** Emoji (Unicode or emoji shortcode) */
  emoji: string;
}

/**
 * Remove reaction request
 *
 * Sent by the client to remove an emoji reaction from a message.
 *
 * @event remove_reaction
 * @direction Client -> Server
 *
 * @example
 * ```typescript
 * // Client - user clicks to remove previously selected emoji
 * socket.emit('remove_reaction', {
 *   messageId: 'message-uuid',
 *   emoji: '👍'
 * });
 * ```
 */
export interface RemoveReactionPayload {
  /** Message ID */
  messageId: string;
  /** Emoji to remove */
  emoji: string;
}

// ==================== Server -> Client ====================

/**
 * Reaction added event
 *
 * Broadcast by the server to all channel members when a user adds a reaction to a message.
 *
 * @event reaction_added
 * @direction Server -> Channel Members
 *
 * @example
 * ```typescript
 * socket.on('reaction_added', (event: ReactionAddedEvent) => {
 *   // Update message's reaction list
 *   addReactionToMessage(event.messageId, {
 *     userId: event.userId,
 *     emoji: event.emoji
 *   });
 * });
 * ```
 */
export interface ReactionAddedEvent {
  /** Message ID */
  messageId: string;
  /** User ID who added the reaction */
  userId: string;
  /** Added emoji */
  emoji: string;
}

/**
 * Reaction removed event
 *
 * Broadcast by the server to all channel members when a user removes a reaction from a message.
 *
 * @event reaction_removed
 * @direction Server -> Channel Members
 *
 * @example
 * ```typescript
 * socket.on('reaction_removed', (event: ReactionRemovedEvent) => {
 *   // Remove from message's reaction list
 *   removeReactionFromMessage(event.messageId, {
 *     userId: event.userId,
 *     emoji: event.emoji
 *   });
 * });
 * ```
 */
export interface ReactionRemovedEvent {
  /** Message ID */
  messageId: string;
  /** User ID who removed the reaction */
  userId: string;
  /** Removed emoji */
  emoji: string;
}

// ==================== Response Types ====================

/**
 * Reaction operation response
 */
export interface ReactionOperationResponse {
  /** Whether operation succeeded */
  success: boolean;
  /** Error message */
  error?: string;
}

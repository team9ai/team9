/**
 * Authentication related WebSocket event type definitions
 *
 * @module events/domains/auth
 */

// ==================== Server -> Client ====================

/**
 * Authentication success event
 *
 * Sent by the server to the client when WebSocket connection authentication succeeds.
 *
 * @event authenticated
 * @direction Server -> Client
 *
 * @example
 * ```typescript
 * // Server side
 * client.emit(WS_EVENTS.AUTH.AUTHENTICATED, { userId: user.id });
 *
 * // Client side
 * socket.on('authenticated', (event: AuthenticatedEvent) => {
 *   console.log('Authentication successful, User ID:', event.userId);
 * });
 * ```
 */
export interface AuthenticatedEvent {
  /** Authenticated user ID */
  userId: string;
}

/**
 * Authentication error event
 *
 * Sent by the server to the client when WebSocket connection authentication fails.
 * The server will disconnect after sending this event.
 *
 * @event auth_error
 * @direction Server -> Client
 *
 * @example
 * ```typescript
 * // Server side
 * client.emit(WS_EVENTS.AUTH.AUTH_ERROR, { message: 'Token expired' });
 * client.disconnect();
 *
 * // Client side
 * socket.on('auth_error', (event: AuthErrorEvent) => {
 *   console.error('Authentication failed:', event.message);
 *   // May need to re-login
 * });
 * ```
 */
export interface AuthErrorEvent {
  /** Error message */
  message: string;
}

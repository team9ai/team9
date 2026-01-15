/**
 * User status related WebSocket event type definitions
 *
 * @module events/domains/user
 */

// ==================== User Status Types ====================

/**
 * User online status enumeration
 */
export type UserStatus = 'online' | 'offline' | 'away' | 'busy';

// ==================== Server -> Client ====================

/**
 * User online event
 *
 * Broadcast by the server to all online members of the same workspace when a user connects and authenticates successfully.
 *
 * @event user_online
 * @direction Server -> Workspace Members
 *
 * @example
 * ```typescript
 * socket.on('user_online', (event: UserOnlineEvent) => {
 *   // Update user status to online in the user list
 *   updateUserStatus(event.userId, 'online');
 *   // Optional: show online notification
 *   showNotification(`${event.username} is now online`);
 * });
 * ```
 */
export interface UserOnlineEvent {
  /** Online user ID */
  userId: string;
  /** Online username */
  username: string;
  /** User's workspace ID */
  workspaceId: string;
}

/**
 * User offline event
 *
 * Broadcast by the server to all online members of the same workspace when all of a user's devices disconnect.
 *
 * @event user_offline
 * @direction Server -> Workspace Members
 *
 * @example
 * ```typescript
 * socket.on('user_offline', (event: UserOfflineEvent) => {
 *   // Update user status to offline in the user list
 *   updateUserStatus(event.userId, 'offline');
 * });
 * ```
 */
export interface UserOfflineEvent {
  /** Offline user ID */
  userId: string;
  /** User's workspace ID */
  workspaceId: string;
}

/**
 * User status changed event
 *
 * Broadcast by the server to related users when a user manually changes their status (e.g., busy, away).
 *
 * @event user_status_changed
 * @direction Server -> Related Users
 *
 * @example
 * ```typescript
 * socket.on('user_status_changed', (event: UserStatusChangedEvent) => {
 *   // Update user status
 *   updateUserStatus(event.userId, event.status);
 *   // Update status icon/color
 *   updateStatusIndicator(event.userId, event.status);
 * });
 * ```
 */
export interface UserStatusChangedEvent {
  /** User ID whose status changed */
  userId: string;
  /** New user status */
  status: UserStatus;
  /** Custom status message (optional) */
  statusMessage?: string;
  /** Status change time */
  changedAt?: string;
}

// ==================== Client -> Server ====================

/**
 * Update user status request
 *
 * Sent by the client to update the current user's online status.
 *
 * @event update_user_status
 * @direction Client -> Server
 *
 * @example
 * ```typescript
 * // Client - user clicks status toggle button
 * socket.emit('update_user_status', {
 *   status: 'busy',
 *   statusMessage: 'Focusing on work'
 * });
 * ```
 */
export interface UpdateUserStatusPayload {
  /** New user status */
  status: UserStatus;
  /** Custom status message (optional) */
  statusMessage?: string;
}

// ==================== Response Types ====================

/**
 * Status update operation response
 */
export interface UserStatusOperationResponse {
  /** Whether operation succeeded */
  success: boolean;
  /** Error message */
  error?: string;
}

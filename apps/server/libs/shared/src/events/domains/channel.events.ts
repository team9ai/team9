/**
 * Channel related WebSocket event type definitions
 *
 * @module events/domains/channel
 */

// ==================== Client -> Server ====================

/**
 * Join channel request
 *
 * Sent by the client to subscribe to channel's real-time messages.
 * The server will verify if the user is a channel member.
 *
 * @event join_channel
 * @direction Client -> Server
 *
 * @example
 * ```typescript
 * // Client side
 * socket.emit('join_channel', { channelId: 'channel-uuid' });
 *
 * // Server response
 * // Success: { success: true }
 * // Failure: { error: 'Not a member of this channel' }
 * ```
 */
export interface JoinChannelPayload {
  /** Channel ID to join */
  channelId: string;
}

/**
 * Leave channel request
 *
 * Sent by the client to unsubscribe from channel's real-time messages.
 *
 * @event leave_channel
 * @direction Client -> Server
 *
 * @example
 * ```typescript
 * // Client side
 * socket.emit('leave_channel', { channelId: 'channel-uuid' });
 * ```
 */
export interface LeaveChannelPayload {
  /** Channel ID to leave */
  channelId: string;
}

// ==================== Server -> Client ====================

/**
 * Channel joined event
 *
 * Broadcast by the server to other channel members when a user joins the channel.
 *
 * @event channel_joined
 * @direction Server -> Channel Members
 *
 * @example
 * ```typescript
 * socket.on('channel_joined', (event: ChannelJoinedEvent) => {
 *   console.log(`${event.username} joined the channel`);
 * });
 * ```
 */
export interface ChannelJoinedEvent {
  /** Channel ID */
  channelId: string;
  /** Joined user ID */
  userId: string;
  /** Joined username */
  username: string;
}

/**
 * Channel left event
 *
 * Broadcast by the server to other channel members when a user leaves the channel.
 *
 * @event channel_left
 * @direction Server -> Channel Members
 *
 * @example
 * ```typescript
 * socket.on('channel_left', (event: ChannelLeftEvent) => {
 *   console.log(`User ${event.userId} left the channel`);
 * });
 * ```
 */
export interface ChannelLeftEvent {
  /** Channel ID */
  channelId: string;
  /** Left user ID */
  userId: string;
}

/**
 * Channel created event
 *
 * Sent by the server to related users (channel members or workspace members) when a new channel is created.
 *
 * @event channel_created
 * @direction Server -> Related Users
 *
 * @example
 * ```typescript
 * socket.on('channel_created', (event: ChannelCreatedEvent) => {
 *   // Add new channel to channel list
 *   addChannel(event);
 * });
 * ```
 */
export interface ChannelCreatedEvent {
  /** Channel ID */
  id: string;
  /** Tenant/Workspace ID */
  tenantId: string;
  /** Channel name */
  name: string;
  /** Channel description */
  description?: string;
  /** Channel avatar URL */
  avatarUrl?: string;
  /** Channel type */
  type: 'direct' | 'public' | 'private';
  /** Creator user ID */
  createdBy: string;
  /** Whether archived */
  isArchived: boolean;
  /** Created at */
  createdAt: string;
  /** Updated at */
  updatedAt: string;
}

/**
 * Channel updated event
 *
 * Broadcast by the server to channel members when channel info (name, description, etc.) is updated.
 *
 * @event channel_updated
 * @direction Server -> Channel Members
 *
 * @example
 * ```typescript
 * socket.on('channel_updated', (event: ChannelUpdatedEvent) => {
 *   // Update local channel info
 *   updateChannel(event.channelId, event);
 * });
 * ```
 */
export interface ChannelUpdatedEvent {
  /** Channel ID */
  channelId: string;
  /** Updated channel name */
  name?: string;
  /** Updated channel description */
  description?: string;
  /** Updated channel avatar */
  avatarUrl?: string;
  /** User ID who performed the update */
  updatedBy: string;
  /** Updated at */
  updatedAt: string;
}

/**
 * Channel deleted event
 *
 * Broadcast by the server to channel members when a channel is deleted.
 *
 * @event channel_deleted
 * @direction Server -> Channel Members
 *
 * @example
 * ```typescript
 * socket.on('channel_deleted', (event: ChannelDeletedEvent) => {
 *   // Remove from channel list
 *   removeChannel(event.channelId);
 *   // If currently in this channel, navigate to another
 *   if (currentChannelId === event.channelId) {
 *     navigateToDefaultChannel();
 *   }
 * });
 * ```
 */
export interface ChannelDeletedEvent {
  /** Deleted channel ID */
  channelId: string;
  /** Deleted channel name (for notification display) */
  channelName?: string;
  /** User ID who performed the deletion */
  deletedBy: string;
}

/**
 * Channel archived event
 *
 * Broadcast by the server to channel members when a channel is archived.
 * Archived channels can still view history but cannot send new messages.
 *
 * @event channel_archived
 * @direction Server -> Channel Members
 *
 * @example
 * ```typescript
 * socket.on('channel_archived', (event: ChannelArchivedEvent) => {
 *   // Update channel status to archived
 *   setChannelArchived(event.channelId, true);
 * });
 * ```
 */
export interface ChannelArchivedEvent {
  /** Archived channel ID */
  channelId: string;
  /** Archived channel name */
  channelName?: string;
  /** User ID who performed the archive */
  archivedBy: string;
}

/**
 * Channel unarchived event
 *
 * Broadcast by the server to channel members when a channel is unarchived.
 *
 * @event channel_unarchived
 * @direction Server -> Channel Members
 *
 * @example
 * ```typescript
 * socket.on('channel_unarchived', (event: ChannelUnarchivedEvent) => {
 *   // Update channel status to not archived
 *   setChannelArchived(event.channelId, false);
 * });
 * ```
 */
export interface ChannelUnarchivedEvent {
  /** Unarchived channel ID */
  channelId: string;
  /** Channel name */
  channelName?: string;
  /** User ID who performed the operation */
  unarchivedBy: string;
}

// ==================== Response Types ====================

/**
 * Join/Leave channel response
 */
export interface ChannelOperationResponse {
  /** Whether operation succeeded */
  success?: boolean;
  /** Error message */
  error?: string;
}

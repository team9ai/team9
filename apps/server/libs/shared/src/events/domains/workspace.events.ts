/**
 * Workspace related WebSocket event type definitions
 *
 * @module events/domains/workspace
 */

import type { UserStatus } from './user.events.js';

// ==================== Workspace Member Types ====================

/**
 * Workspace member role
 */
export type WorkspaceMemberRole = 'owner' | 'admin' | 'member';

/**
 * Workspace member information
 */
export interface WorkspaceMember {
  /** Member relationship ID */
  id: string;
  /** User ID */
  userId: string;
  /** Workspace ID */
  workspaceId: string;
  /** Member role */
  role: WorkspaceMemberRole;
  /** Joined at */
  joinedAt: string;
  /** User details */
  user?: {
    id: string;
    username: string;
    displayName?: string;
    email: string;
    avatarUrl?: string;
    status: UserStatus;
  };
}

// ==================== Client -> Server ====================

/**
 * Join workspace request
 *
 * Sent by the client to subscribe to workspace's real-time events (e.g., member online/offline, new channel creation).
 * The server will verify if the user is a workspace member.
 *
 * @event join_workspace
 * @direction Client -> Server
 *
 * @example
 * ```typescript
 * // Client - when entering workspace
 * socket.emit('join_workspace', { workspaceId: 'workspace-uuid' });
 *
 * // Server response
 * // On success, will send workspace_members_list event
 * ```
 */
export interface JoinWorkspacePayload {
  /** Workspace ID to join */
  workspaceId: string;
}

// ==================== Server -> Client ====================

/**
 * Workspace members list event
 *
 * Sent by the server to the user after joining a workspace, containing all current member information.
 *
 * @event workspace_members_list
 * @direction Server -> Client
 *
 * @example
 * ```typescript
 * socket.on('workspace_members_list', (event: WorkspaceMembersListEvent) => {
 *   // Initialize member list
 *   setWorkspaceMembers(event.workspaceId, event.members);
 * });
 * ```
 */
export interface WorkspaceMembersListEvent {
  /** Workspace ID */
  workspaceId: string;
  /** Member list */
  members: WorkspaceMember[];
}

/**
 * Workspace member joined event
 *
 * Broadcast by the server to all online workspace members when a new member joins.
 *
 * @event workspace_member_joined
 * @direction Server -> Workspace Members
 *
 * @example
 * ```typescript
 * socket.on('workspace_member_joined', (event: WorkspaceMemberJoinedEvent) => {
 *   // Add new member to list
 *   addWorkspaceMember(event.workspaceId, event.member);
 *   // Optional: show notification
 *   showNotification(`${event.member.user?.username} joined the workspace`);
 * });
 * ```
 */
export interface WorkspaceMemberJoinedEvent {
  /** Workspace ID */
  workspaceId: string;
  /** New member information */
  member: WorkspaceMember;
}

/**
 * Workspace member left event
 *
 * Broadcast by the server to all online workspace members when a member voluntarily leaves.
 *
 * @event workspace_member_left
 * @direction Server -> Workspace Members
 *
 * @example
 * ```typescript
 * socket.on('workspace_member_left', (event: WorkspaceMemberLeftEvent) => {
 *   // Remove from member list
 *   removeWorkspaceMember(event.workspaceId, event.userId);
 * });
 * ```
 */
export interface WorkspaceMemberLeftEvent {
  /** Workspace ID */
  workspaceId: string;
  /** Left user ID */
  userId: string;
  /** Left username (for notification display) */
  username?: string;
}

/**
 * Workspace member removed event
 *
 * Broadcast by the server to all online workspace members when a member is removed by an admin.
 * The removed member will also receive this event for client-side handling.
 *
 * @event workspace_member_removed
 * @direction Server -> Workspace Members
 *
 * @example
 * ```typescript
 * socket.on('workspace_member_removed', (event: WorkspaceMemberRemovedEvent) => {
 *   // If current user was removed
 *   if (event.userId === currentUserId) {
 *     showNotification('You have been removed from this workspace');
 *     navigateToHome();
 *     return;
 *   }
 *   // Otherwise remove from member list
 *   removeWorkspaceMember(event.workspaceId, event.userId);
 * });
 * ```
 */
export interface WorkspaceMemberRemovedEvent {
  /** Workspace ID */
  workspaceId: string;
  /** Removed user ID */
  userId: string;
  /** Removed username */
  username?: string;
  /** Admin user ID who performed the removal */
  removedBy: string;
}

// ==================== Response Types ====================

/**
 * Workspace operation response
 */
export interface WorkspaceOperationResponse {
  /** Whether operation succeeded */
  success?: boolean;
  /** Error message */
  error?: string;
}

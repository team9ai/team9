/**
 * 工作空间相关 WebSocket 事件类型定义
 *
 * @module events/domains/workspace
 */

import type { UserStatus } from './user.events.js';

// ==================== 工作空间成员类型 ====================

/**
 * 工作空间成员角色
 */
export type WorkspaceMemberRole = 'owner' | 'admin' | 'member';

/**
 * 工作空间成员信息
 */
export interface WorkspaceMember {
  /** 成员关系 ID */
  id: string;
  /** 用户 ID */
  userId: string;
  /** 工作空间 ID */
  workspaceId: string;
  /** 成员角色 */
  role: WorkspaceMemberRole;
  /** 加入时间 */
  joinedAt: string;
  /** 用户详细信息 */
  user?: {
    id: string;
    username: string;
    displayName?: string;
    email: string;
    avatarUrl?: string;
    status: UserStatus;
  };
}

// ==================== 客户端 -> 服务器 ====================

/**
 * 加入工作空间请求
 *
 * 客户端发送此事件以订阅工作空间的实时事件（如成员上下线、新频道创建等）。
 * 服务器会验证用户是否为工作空间成员。
 *
 * @event join_workspace
 * @direction Client -> Server
 *
 * @example
 * ```typescript
 * // 客户端 - 进入工作空间时
 * socket.emit('join_workspace', { workspaceId: 'workspace-uuid' });
 *
 * // 服务器响应
 * // 成功后会发送 workspace_members_list 事件
 * ```
 */
export interface JoinWorkspacePayload {
  /** 要加入的工作空间 ID */
  workspaceId: string;
}

// ==================== 服务器 -> 客户端 ====================

/**
 * 工作空间成员列表事件
 *
 * 当用户加入工作空间后，服务器发送此事件给该用户，包含当前所有成员信息。
 *
 * @event workspace_members_list
 * @direction Server -> Client
 *
 * @example
 * ```typescript
 * socket.on('workspace_members_list', (event: WorkspaceMembersListEvent) => {
 *   // 初始化成员列表
 *   setWorkspaceMembers(event.workspaceId, event.members);
 * });
 * ```
 */
export interface WorkspaceMembersListEvent {
  /** 工作空间 ID */
  workspaceId: string;
  /** 成员列表 */
  members: WorkspaceMember[];
}

/**
 * 工作空间成员加入事件
 *
 * 当新成员加入工作空间后，服务器广播此事件给工作空间所有在线成员。
 *
 * @event workspace_member_joined
 * @direction Server -> Workspace Members
 *
 * @example
 * ```typescript
 * socket.on('workspace_member_joined', (event: WorkspaceMemberJoinedEvent) => {
 *   // 添加新成员到列表
 *   addWorkspaceMember(event.workspaceId, event.member);
 *   // 可选：显示通知
 *   showNotification(`${event.member.user?.username} 加入了工作空间`);
 * });
 * ```
 */
export interface WorkspaceMemberJoinedEvent {
  /** 工作空间 ID */
  workspaceId: string;
  /** 新加入的成员信息 */
  member: WorkspaceMember;
}

/**
 * 工作空间成员离开事件
 *
 * 当成员主动离开工作空间后，服务器广播此事件给工作空间所有在线成员。
 *
 * @event workspace_member_left
 * @direction Server -> Workspace Members
 *
 * @example
 * ```typescript
 * socket.on('workspace_member_left', (event: WorkspaceMemberLeftEvent) => {
 *   // 从成员列表中移除
 *   removeWorkspaceMember(event.workspaceId, event.userId);
 * });
 * ```
 */
export interface WorkspaceMemberLeftEvent {
  /** 工作空间 ID */
  workspaceId: string;
  /** 离开的用户 ID */
  userId: string;
  /** 离开的用户名（用于显示通知） */
  username?: string;
}

/**
 * 工作空间成员被移除事件
 *
 * 当成员被管理员移除后，服务器广播此事件给工作空间所有在线成员。
 * 被移除的成员也会收到此事件，以便客户端做相应处理。
 *
 * @event workspace_member_removed
 * @direction Server -> Workspace Members
 *
 * @example
 * ```typescript
 * socket.on('workspace_member_removed', (event: WorkspaceMemberRemovedEvent) => {
 *   // 如果是当前用户被移除
 *   if (event.userId === currentUserId) {
 *     showNotification('您已被移出此工作空间');
 *     navigateToHome();
 *     return;
 *   }
 *   // 否则从成员列表中移除
 *   removeWorkspaceMember(event.workspaceId, event.userId);
 * });
 * ```
 */
export interface WorkspaceMemberRemovedEvent {
  /** 工作空间 ID */
  workspaceId: string;
  /** 被移除的用户 ID */
  userId: string;
  /** 被移除的用户名 */
  username?: string;
  /** 执行移除操作的管理员用户 ID */
  removedBy: string;
}

// ==================== 响应类型 ====================

/**
 * 工作空间操作响应
 */
export interface WorkspaceOperationResponse {
  /** 操作是否成功 */
  success?: boolean;
  /** 错误信息 */
  error?: string;
}

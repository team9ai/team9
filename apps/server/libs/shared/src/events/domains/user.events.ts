/**
 * 用户状态相关 WebSocket 事件类型定义
 *
 * @module events/domains/user
 */

// ==================== 用户状态类型 ====================

/**
 * 用户在线状态枚举
 */
export type UserStatus = 'online' | 'offline' | 'away' | 'busy';

// ==================== 服务器 -> 客户端 ====================

/**
 * 用户上线事件
 *
 * 当用户建立 WebSocket 连接并认证成功后，服务器广播此事件给同一工作空间的所有在线成员。
 *
 * @event user_online
 * @direction Server -> Workspace Members
 *
 * @example
 * ```typescript
 * socket.on('user_online', (event: UserOnlineEvent) => {
 *   // 更新用户列表中该用户的状态为在线
 *   updateUserStatus(event.userId, 'online');
 *   // 可选：显示上线通知
 *   showNotification(`${event.username} 已上线`);
 * });
 * ```
 */
export interface UserOnlineEvent {
  /** 上线的用户 ID */
  userId: string;
  /** 上线的用户名 */
  username: string;
  /** 用户所在的工作空间 ID */
  workspaceId: string;
}

/**
 * 用户离线事件
 *
 * 当用户所有设备都断开 WebSocket 连接后，服务器广播此事件给同一工作空间的所有在线成员。
 *
 * @event user_offline
 * @direction Server -> Workspace Members
 *
 * @example
 * ```typescript
 * socket.on('user_offline', (event: UserOfflineEvent) => {
 *   // 更新用户列表中该用户的状态为离线
 *   updateUserStatus(event.userId, 'offline');
 * });
 * ```
 */
export interface UserOfflineEvent {
  /** 离线的用户 ID */
  userId: string;
  /** 用户所在的工作空间 ID */
  workspaceId: string;
}

/**
 * 用户状态变更事件
 *
 * 当用户主动切换状态（如设置为忙碌、离开等）后，服务器广播此事件给相关用户。
 *
 * @event user_status_changed
 * @direction Server -> Related Users
 *
 * @example
 * ```typescript
 * socket.on('user_status_changed', (event: UserStatusChangedEvent) => {
 *   // 更新用户状态
 *   updateUserStatus(event.userId, event.status);
 *   // 更新状态图标/颜色
 *   updateStatusIndicator(event.userId, event.status);
 * });
 * ```
 */
export interface UserStatusChangedEvent {
  /** 状态变更的用户 ID */
  userId: string;
  /** 新的用户状态 */
  status: UserStatus;
  /** 自定义状态消息（可选） */
  statusMessage?: string;
  /** 状态变更时间 */
  changedAt?: string;
}

// ==================== 客户端 -> 服务器 ====================

/**
 * 更新用户状态请求
 *
 * 客户端发送此事件以更新当前用户的在线状态。
 *
 * @event update_user_status
 * @direction Client -> Server
 *
 * @example
 * ```typescript
 * // 客户端 - 用户点击状态切换按钮
 * socket.emit('update_user_status', {
 *   status: 'busy',
 *   statusMessage: '专注工作中'
 * });
 * ```
 */
export interface UpdateUserStatusPayload {
  /** 新的用户状态 */
  status: UserStatus;
  /** 自定义状态消息（可选） */
  statusMessage?: string;
}

// ==================== 响应类型 ====================

/**
 * 状态更新操作响应
 */
export interface UserStatusOperationResponse {
  /** 操作是否成功 */
  success: boolean;
  /** 错误信息 */
  error?: string;
}

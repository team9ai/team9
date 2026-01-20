/**
 * Message types for distributed IM architecture
 */

/**
 * IM Message envelope - the standard message format
 */
export interface IMMessageEnvelope {
  // Unique message ID (UUID)
  msgId: string;

  // Message sequence ID (for ordering within channel)
  seqId?: bigint;

  // Client-generated message ID (for deduplication)
  clientMsgId?: string;

  // Message type
  type: MessageType;

  // Sender user ID
  senderId: string;

  // Target type (channel or direct user)
  targetType: 'channel' | 'user';

  // Target ID (channel ID or user ID)
  targetId: string;

  // Message payload
  payload: MessagePayload;

  // Timestamp (milliseconds)
  timestamp: number;

  // Retry count (for redelivery)
  retryCount?: number;
}

export type MessageType =
  | 'text'
  | 'file'
  | 'image'
  | 'system'
  | 'ack'
  | 'typing'
  | 'read'
  | 'presence';

/**
 * Message payload types
 */
export interface TextMessagePayload {
  content: string;
  parentId?: string;
  rootId?: string;
  mentions?: string[];
}

export interface FileMessagePayload {
  fileUrl: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  thumbnailUrl?: string;
}

export interface ImageMessagePayload {
  imageUrl: string;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
}

export interface SystemMessagePayload {
  action: string;
  data?: Record<string, unknown>;
}

export interface AckPayload {
  msgId: string;
  ackType: 'delivered' | 'read';
}

export interface TypingPayload {
  isTyping: boolean;
}

export interface ReadPayload {
  lastReadMsgId: string;
}

export interface PresencePayload {
  event: 'online' | 'offline';
  timestamp?: number;
}

export type MessagePayload =
  | TextMessagePayload
  | FileMessagePayload
  | ImageMessagePayload
  | SystemMessagePayload
  | AckPayload
  | TypingPayload
  | ReadPayload
  | PresencePayload
  | Record<string, unknown>;

/**
 * Upstream message - sent from Gateway to Logic Service
 */
export interface UpstreamMessage {
  // Source Gateway node ID
  gatewayId: string;

  // Source user ID
  userId: string;

  // Source socket ID
  socketId: string;

  // The message envelope
  message: IMMessageEnvelope;

  // Timestamp when Gateway received the message
  receivedAt: number;
}

/**
 * Downstream message - sent from Logic Service to Gateway
 */
export interface DownstreamMessage extends IMMessageEnvelope {
  // Target user IDs
  targetUserIds: string[];

  // Target Gateway node IDs (resolved by Logic Service)
  targetGatewayIds: string[];

  // Whether this is a retry
  isRetry?: boolean;
}

/**
 * ACK message from client
 */
export interface ClientAck {
  msgId: string;
  ackType: 'delivered' | 'read';
  timestamp: number;
}

/**
 * Server ACK response to client
 */
export interface ServerAckResponse {
  msgId: string;
  clientMsgId?: string;
  status: 'ok' | 'duplicate' | 'error';
  seqId?: string; // BigInt as string for JSON serialization
  serverTime: number;
  error?: string;
}

/**
 * Message delivery status
 */
export enum MessageDeliveryStatus {
  PENDING = 'pending', // Waiting to be sent
  SENT = 'sent', // Sent to Gateway queue
  DELIVERED = 'delivered', // Client confirmed receipt
  READ = 'read', // Client has read
  FAILED = 'failed', // Delivery failed after retries
}

/**
 * User session info for routing
 */
export interface UserSession {
  gatewayId: string;
  socketId: string;
  loginTime: number;
  lastActiveTime: number;
  deviceInfo?: {
    platform: string;
    version: string;
    deviceId?: string;
  };
}

/**
 * Gateway node info
 */
export interface GatewayNodeInfo {
  nodeId: string;
  address: string;
  startTime: number;
  lastHeartbeat: number;
  connectionCount: number;
}

/**
 * Heartbeat messages
 */
export interface PingMessage {
  type: 'ping';
  timestamp: number;
}

export interface PongMessage {
  type: 'pong';
  timestamp: number;
  serverTime: number;
}

// ============ HTTP API Types ============

/**
 * DTO for creating a message via HTTP API
 * Used by Gateway to call Logic Service
 */
export interface CreateMessageAttachmentDto {
  fileKey: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
}

export interface CreateMessageDto {
  // Client-generated message ID (for deduplication)
  clientMsgId: string;

  // Target channel ID
  channelId: string;

  // Sender user ID
  senderId: string;

  // Message content
  content: string;

  // Parent message ID (direct parent for replies)
  parentId?: string;

  // Root message ID (thread root, for efficient querying)
  rootId?: string;

  // Message type
  type: 'text' | 'file' | 'image';

  // File attachments
  attachments?: CreateMessageAttachmentDto[];

  // Additional metadata
  metadata?: Record<string, unknown>;

  // Workspace ID (for offline message routing)
  workspaceId?: string;
}

/**
 * Response from Logic Service after creating a message
 */
export interface CreateMessageResponse {
  // Server-generated message ID
  msgId: string;

  // Sequence ID (for ordering within channel)
  seqId: string;

  // Echo back the client message ID
  clientMsgId: string;

  // Status of the operation
  status: 'persisted' | 'duplicate';

  // Server timestamp
  timestamp: number;

  // Error message if status is not successful
  error?: string;
}

// ============ Multi-Device Session Types ============

/**
 * Device session info for multi-device support
 * Extends UserSession with device-specific information
 */
export interface DeviceSession {
  // Socket ID for this device
  socketId: string;

  // Gateway node ID where this device is connected
  gatewayId: string;

  // When this device logged in
  loginTime: number;

  // Last activity timestamp
  lastActiveTime: number;

  // Device information
  deviceInfo?: {
    platform: string;
    version: string;
    deviceId?: string;
    userAgent?: string;
  };
}

/**
 * Outbox event payload for message delivery
 */
export interface OutboxEventPayload {
  // Message details
  msgId: string;
  channelId: string;
  senderId: string;
  content: string;
  parentId?: string;
  rootId?: string;
  type: MessageType;
  seqId: string;
  timestamp: number;

  // Workspace for routing
  workspaceId?: string;

  // Metadata
  metadata?: Record<string, unknown>;
}

// ============ Post-Broadcast Task Types ============

/**
 * Post-broadcast task sent from Gateway to Logic Service
 * After Gateway broadcasts to online users, this task handles:
 * - Offline message storage
 * - Unread count updates
 * - Mark Outbox event as completed
 */
export interface PostBroadcastTask {
  // Message ID
  msgId: string;

  // Channel ID
  channelId: string;

  // Sender ID (to exclude from recipients)
  senderId: string;

  // Workspace ID (for offline message routing)
  workspaceId?: string;

  // Timestamp when broadcast was sent
  broadcastAt: number;
}

// ============ Notification Task Types ============

/**
 * Base notification task payload
 */
export interface NotificationTaskBase {
  type: NotificationTaskType;
  timestamp: number;
}

export type NotificationTaskType =
  | 'mention'
  | 'reply'
  | 'dm'
  | 'workspace_invitation'
  | 'member_joined'
  | 'role_changed';

/**
 * Mention notification task
 */
export interface MentionNotificationTask extends NotificationTaskBase {
  type: 'mention';
  payload: {
    messageId: string;
    channelId: string;
    tenantId: string;
    senderId: string;
    senderUsername: string;
    channelName: string;
    content: string;
    mentions: Array<{
      userId?: string;
      type: 'user' | 'channel' | 'everyone' | 'here';
    }>;
  };
}

/**
 * Reply notification task
 */
export interface ReplyNotificationTask extends NotificationTaskBase {
  type: 'reply';
  payload: {
    messageId: string;
    channelId: string;
    tenantId: string;
    senderId: string;
    senderUsername: string;
    parentMessageId: string;
    parentSenderId: string;
    content: string;
  };
}

/**
 * DM notification task
 */
export interface DMNotificationTask extends NotificationTaskBase {
  type: 'dm';
  payload: {
    messageId: string;
    channelId: string;
    senderId: string;
    senderUsername: string;
    recipientId: string;
    content: string;
  };
}

/**
 * Workspace invitation notification task
 */
export interface WorkspaceInvitationNotificationTask extends NotificationTaskBase {
  type: 'workspace_invitation';
  payload: {
    invitationId: string;
    tenantId: string;
    tenantName: string;
    inviterId: string;
    inviterUsername: string;
    inviteeId: string;
  };
}

/**
 * Member joined notification task
 */
export interface MemberJoinedNotificationTask extends NotificationTaskBase {
  type: 'member_joined';
  payload: {
    tenantId: string;
    tenantName: string;
    newMemberId: string;
    newMemberUsername: string;
    notifyUserIds: string[];
  };
}

/**
 * Role changed notification task
 */
export interface RoleChangedNotificationTask extends NotificationTaskBase {
  type: 'role_changed';
  payload: {
    tenantId: string;
    tenantName: string;
    userId: string;
    oldRole: string;
    newRole: string;
    changedById: string;
    changedByUsername: string;
  };
}

/**
 * Union type of all notification tasks
 */
export type NotificationTask =
  | MentionNotificationTask
  | ReplyNotificationTask
  | DMNotificationTask
  | WorkspaceInvitationNotificationTask
  | MemberJoinedNotificationTask
  | RoleChangedNotificationTask;

// ============ Notification Delivery Task Types ============
// These tasks are sent from im-worker to Gateway for WebSocket push

/**
 * Notification actor info for delivery
 */
export interface NotificationActorInfo {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

/**
 * Notification delivery payload (sent to Gateway for WebSocket push)
 */
export interface NotificationDeliveryPayload {
  id: string;
  category: string;
  type: string;
  priority: string;
  title: string;
  body: string | null;
  actor: NotificationActorInfo | null;
  tenantId: string | null;
  channelId: string | null;
  messageId: string | null;
  actionUrl: string | null;
  createdAt: string;
}

/**
 * Notification counts payload
 */
export interface NotificationCountsPayload {
  total: number;
  byCategory: {
    message: number;
    system: number;
    workspace: number;
  };
}

/**
 * Base delivery task
 */
export interface DeliveryTaskBase {
  type: 'new' | 'counts' | 'read';
  userId: string;
  timestamp: number;
}

/**
 * New notification delivery task
 */
export interface NewNotificationDeliveryTask extends DeliveryTaskBase {
  type: 'new';
  payload: NotificationDeliveryPayload;
}

/**
 * Counts update delivery task
 */
export interface CountsUpdateDeliveryTask extends DeliveryTaskBase {
  type: 'counts';
  payload: NotificationCountsPayload;
}

/**
 * Notification read delivery task (for multi-device sync)
 */
export interface NotificationReadDeliveryTask extends DeliveryTaskBase {
  type: 'read';
  payload: {
    notificationIds: string[];
    readAt: string;
  };
}

/**
 * Union type of all delivery tasks
 */
export type NotificationDeliveryTask =
  | NewNotificationDeliveryTask
  | CountsUpdateDeliveryTask
  | NotificationReadDeliveryTask;

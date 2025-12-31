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
  | 'read';

/**
 * Message payload types
 */
export interface TextMessagePayload {
  content: string;
  parentId?: string;
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

export type MessagePayload =
  | TextMessagePayload
  | FileMessagePayload
  | ImageMessagePayload
  | SystemMessagePayload
  | AckPayload
  | TypingPayload
  | ReadPayload
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

/**
 * AI Bot Streaming Events
 *
 * Events for real-time streaming of AI bot responses,
 * including text content and thinking/reasoning process.
 */

/**
 * Streaming start - bot begins generating a response
 */
export interface StreamingStartEvent {
  /** Unique stream ID (UUID) for this streaming session */
  streamId: string;
  /** Channel where the message is being streamed */
  channelId: string;
  /** Bot user ID (injected by server from authenticated socket) */
  senderId: string;
  /** Optional parent message ID (for threaded replies) */
  parentId?: string;
  /** Optional initial agent-event metadata */
  metadata?: Record<string, unknown>;
  /** Timestamp when streaming started */
  startedAt: number;
}

/**
 * Streaming text update - full accumulated content
 */
export interface StreamingContentEvent {
  streamId: string;
  channelId: string;
  senderId: string;
  /** Full accumulated text content so far */
  content: string;
}

/**
 * Streaming thinking update - full accumulated reasoning content
 */
export interface StreamingThinkingContentEvent {
  streamId: string;
  channelId: string;
  senderId: string;
  /** Full accumulated thinking content so far */
  content: string;
}

/**
 * Streaming metadata update - transient stream state, not persisted as history
 */
export interface StreamingMetadataEvent {
  streamId: string;
  channelId: string;
  senderId: string;
  metadata: Record<string, unknown>;
}

/**
 * Streaming end - finalization with persisted message
 */
export interface StreamingEndEvent {
  streamId: string;
  channelId: string;
  senderId: string;
  /** Final content when the authenticated bot finalizes over Socket.IO */
  content?: string;
  /** Optional final thinking content when finalized over Socket.IO */
  thinking?: string;
  /** The final persisted message broadcast by the gateway */
  message?: Record<string, unknown> | null;
}

/**
 * Streaming abort - stream terminated before completion
 */
export interface StreamingAbortEvent {
  streamId: string;
  channelId: string;
  senderId: string;
  /** Reason for abort */
  reason: 'error' | 'cancelled' | 'timeout' | 'disconnect';
  /** Optional error message */
  error?: string;
}

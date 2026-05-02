/**
 * Permission WebSocket event type definitions
 *
 * Events for the permission request/grant lifecycle.
 *
 * @module events/domains/permissions
 */

// ==================== Permission Event Names ====================

export const PERMISSION_EVENTS = Object.freeze({
  REQUEST_CREATED: 'permission_request_created',
  REQUEST_DECIDED: 'permission_request_decided',
  REQUEST_CONSUMED: 'permission_request_consumed',
  GRANT_CREATED: 'permission_grant_created',
  GRANT_REVOKED: 'permission_grant_revoked',
} as const);

// ==================== Payload Interfaces ====================

/**
 * Payload for permission_request_created event.
 * Broadcast to each approver when a bot creates a permission request.
 *
 * @event permission_request_created
 * @direction Server -> Client
 */
export interface PermissionRequestCreatedPayload {
  /** Request ID */
  id: string;
  /** Human-readable spell ID for the request */
  spellId: string;
  /** Tenant / workspace ID */
  tenantId: string;
  /** Bot ID that raised the request */
  requesterBotId: string;
  /** Permission key being requested */
  permissionKey: string;
  /** Metadata passed with the request */
  requestedMetadata: Record<string, unknown>;
  /** Channel the request was raised in, if any */
  contextChannelId: string | null;
  /** When the request expires (ISO 8601 string or Date) */
  expiresAt: string | Date;
  /** Human-readable reason provided by the bot */
  reason: string | null;
}

/**
 * Payload for permission_request_decided event.
 * Broadcast to approvers and the requester bot user when a decision is made.
 *
 * @event permission_request_decided
 * @direction Server -> Client
 */
export interface PermissionRequestDecidedPayload {
  /** Request ID */
  id: string;
  /** Human-readable spell ID */
  spellId: string;
  /** Final status of the request */
  status: 'approved_once' | 'approved_durable' | 'denied' | 'cancelled';
  /** User ID that decided, or null for bot-initiated cancellations */
  decidedByUserId: string | null;
  /** Durable grant ID if decision was 'remember', otherwise null */
  durableGrantId: string | null;
}

/**
 * Payload for permission_request_consumed event.
 * Broadcast when an approved_once request is consumed by the gate check.
 *
 * @event permission_request_consumed
 * @direction Server -> Client
 */
export interface PermissionRequestConsumedPayload {
  /** Request ID */
  id: string;
  /** Bot ID that consumed the permission */
  requesterBotId: string;
  /** Permission key that was consumed */
  permissionKey: string;
}

/**
 * Payload for permission_grant_created event.
 * Broadcast to workspace admins when a durable grant is created.
 *
 * @event permission_grant_created
 * @direction Server -> Client
 */
export interface PermissionGrantCreatedPayload {
  /** Grant ID */
  id: string;
  /** Tenant / workspace ID */
  tenantId: string;
  /** Subject kind (agent, channel-session, execution-session, task) */
  subjectKind: string;
  /** Subject ID */
  subjectId: string;
  /** Permission key */
  permissionKey: string;
  /** Scope metadata attached to the grant */
  scopeMetadata: Record<string, unknown>;
}

/**
 * Payload for permission_grant_revoked event.
 * Broadcast to workspace admins when a grant is revoked.
 *
 * @event permission_grant_revoked
 * @direction Server -> Client
 */
export interface PermissionGrantRevokedPayload {
  /** Grant ID */
  id: string;
  /** Tenant / workspace ID */
  tenantId: string;
}

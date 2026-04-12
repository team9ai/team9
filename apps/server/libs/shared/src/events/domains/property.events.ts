/**
 * Property, View, and Tab related WebSocket event type definitions
 *
 * @module events/domains/property
 */

import type {
  PropertyDefinitionResponse,
  ViewResponse,
  TabResponse,
} from '../../types/property.types.js';

// ==================== Property Definition Events ====================

/**
 * Property definition created event
 *
 * Broadcast by the server to channel members when a new property definition is added.
 *
 * @event property_definition_created
 * @direction Server -> Channel Members
 */
export interface PropertyDefinitionCreatedEvent {
  /** Channel ID */
  channelId: string;
  /** The newly created property definition */
  definition: PropertyDefinitionResponse;
}

/**
 * Property definition updated event
 *
 * Broadcast by the server to channel members when a property definition is modified.
 *
 * @event property_definition_updated
 * @direction Server -> Channel Members
 */
export interface PropertyDefinitionUpdatedEvent {
  /** Channel ID */
  channelId: string;
  /** Property definition ID */
  definitionId: string;
  /** Changed fields (partial update) */
  changes: Partial<PropertyDefinitionResponse>;
}

/**
 * Property definition deleted event
 *
 * Broadcast by the server to channel members when a property definition is removed.
 *
 * @event property_definition_deleted
 * @direction Server -> Channel Members
 */
export interface PropertyDefinitionDeletedEvent {
  /** Channel ID */
  channelId: string;
  /** Deleted property definition ID */
  definitionId: string;
}

// ==================== Message Property Events ====================

/**
 * Message property changed event
 *
 * Broadcast by the server to channel members when properties on a message are set or removed.
 *
 * @event message_property_changed
 * @direction Server -> Channel Members
 */
export interface MessagePropertyChangedEvent {
  /** Channel ID */
  channelId: string;
  /** Message ID whose properties changed */
  messageId: string;
  /** Property changes */
  properties: {
    /** Properties that were set (propertyKey -> value) */
    set?: Record<string, unknown>;
    /** Property keys that were removed */
    removed?: string[];
  };
  /** User ID who performed the change */
  performedBy: string;
}

// ==================== View Events ====================

/**
 * View created event
 *
 * Broadcast by the server to channel members when a new view is created.
 *
 * @event view_created
 * @direction Server -> Channel Members
 */
export interface ViewCreatedEvent {
  /** Channel ID */
  channelId: string;
  /** The newly created view */
  view: ViewResponse;
}

/**
 * View updated event
 *
 * Broadcast by the server to channel members when a view is modified.
 *
 * @event view_updated
 * @direction Server -> Channel Members
 */
export interface ViewUpdatedEvent {
  /** Channel ID */
  channelId: string;
  /** View ID */
  viewId: string;
  /** Changed fields (partial update) */
  changes: Partial<ViewResponse>;
}

/**
 * View deleted event
 *
 * Broadcast by the server to channel members when a view is removed.
 *
 * @event view_deleted
 * @direction Server -> Channel Members
 */
export interface ViewDeletedEvent {
  /** Channel ID */
  channelId: string;
  /** Deleted view ID */
  viewId: string;
}

// ==================== Tab Events ====================

/**
 * Tab created event
 *
 * Broadcast by the server to channel members when a new tab is created.
 *
 * @event tab_created
 * @direction Server -> Channel Members
 */
export interface TabCreatedEvent {
  /** Channel ID */
  channelId: string;
  /** The newly created tab */
  tab: TabResponse;
}

/**
 * Tab updated event
 *
 * Broadcast by the server to channel members when a tab is modified.
 *
 * @event tab_updated
 * @direction Server -> Channel Members
 */
export interface TabUpdatedEvent {
  /** Channel ID */
  channelId: string;
  /** Tab ID */
  tabId: string;
  /** Changed fields (partial update) */
  changes: Partial<TabResponse>;
}

/**
 * Tab deleted event
 *
 * Broadcast by the server to channel members when a tab is removed.
 *
 * @event tab_deleted
 * @direction Server -> Channel Members
 */
export interface TabDeletedEvent {
  /** Channel ID */
  channelId: string;
  /** Deleted tab ID */
  tabId: string;
}

/**
 * Property system types for message properties, views, and tabs
 *
 * @module types/property
 */

// ==================== Property Value Types ====================

/**
 * All supported property value types
 */
export type PropertyValueType =
  | 'text'
  | 'number'
  | 'boolean'
  | 'single_select'
  | 'multi_select'
  | 'person'
  | 'date'
  | 'timestamp'
  | 'date_range'
  | 'timestamp_range'
  | 'recurring'
  | 'url'
  | 'message_ref'
  | 'file'
  | 'image'
  | 'tags';

// ==================== Select Option ====================

/**
 * Option for single_select and multi_select property types
 */
export interface SelectOption {
  /** Option value (unique within the property) */
  value: string;
  /** Display label */
  label: string;
  /** Color code (e.g. hex or named color) */
  color?: string;
}

// ==================== Message Reference Config ====================

/**
 * Scope for message reference properties
 */
export type MessageRefScope = 'same_channel' | 'any';

/**
 * Cardinality for message reference properties
 */
export type MessageRefCardinality = 'single' | 'multi';

/**
 * Kind of relation between messages
 */
export type RelationKind = 'parent' | 'related';

/**
 * Configuration for message_ref property type
 */
export interface MessageRefConfig {
  /** Scope of allowed target messages */
  scope: MessageRefScope;
  /** Whether multiple targets are allowed */
  cardinality: MessageRefCardinality;
  /** Kind of relation (parent/related); optional for backward compatibility */
  relationKind?: RelationKind;
}

/**
 * Default configuration for message_ref properties
 */
export const DEFAULT_MESSAGE_REF_CONFIG: MessageRefConfig = {
  scope: 'any',
  cardinality: 'multi',
};

// ==================== Property Definition ====================

/**
 * Property definition response (matches channel_property_definitions table)
 */
export interface PropertyDefinitionResponse {
  /** Property definition ID */
  id: string;
  /** Channel this property belongs to */
  channelId: string;
  /** Property key (unique within channel) */
  key: string;
  /** Human-readable description */
  description: string | null;
  /** Property value type */
  valueType: PropertyValueType;
  /** Whether this is a native (built-in) property */
  isNative: boolean;
  /** Whether this property is required */
  isRequired: boolean;
  /** Default value (JSON) */
  defaultValue?: unknown;
  /** Additional configuration (e.g. select options) */
  config?: Record<string, unknown>;
  /** Display order */
  order: number;
  /** Whether AI auto-fill is enabled */
  aiAutoFill: boolean;
  /** Custom AI auto-fill prompt */
  aiAutoFillPrompt: string | null;
  /** Policy for showing in chat: 'show' | 'auto' | 'hide' */
  showInChatPolicy: string;
  /** Whether new options can be added (for select types) */
  allowNewOptions: boolean;
  /** Who created this property */
  createdBy: string | null;
  /** Created at */
  createdAt: string;
  /** Updated at */
  updatedAt: string;
}

// ==================== Message Property Values ====================

/**
 * A single property value attached to a message
 */
export interface MessagePropertyValue {
  /** Property definition ID */
  definitionId: string;
  /** The stored value (type depends on definition type) */
  value: unknown;
}

/**
 * Map of property definition ID -> property value for a message
 */
export type MessagePropertiesMap = Record<string, MessagePropertyValue>;

// ==================== View Types ====================

/**
 * Filter operator for view filters
 */
export type ViewFilterOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains'
  | 'not_contains'
  | 'is_empty'
  | 'is_not_empty'
  | 'in'
  | 'not_in';

/**
 * A single filter condition in a view
 */
export interface ViewFilter {
  /** Property key to filter on */
  propertyKey: string;
  /** Filter operator */
  operator: ViewFilterOperator;
  /** Filter value (type depends on operator) */
  value?: unknown;
}

/**
 * Sort direction
 */
export type ViewSortDirection = 'asc' | 'desc';

/**
 * A single sort rule in a view
 */
export interface ViewSort {
  /** Property key to sort by */
  propertyKey: string;
  /** Sort direction */
  direction: ViewSortDirection;
}

/**
 * View configuration (filters, sorts, visible columns, grouping)
 */
export interface ViewConfig {
  /** Filter conditions */
  filters?: ViewFilter[];
  /** Sort rules */
  sorts?: ViewSort[];
  /** Visible property keys (column order) */
  visibleProperties?: string[];
  /** Mode for visibleProperties: 'blacklist' hides listed, 'whitelist' shows only listed */
  visiblePropertiesMode?: 'blacklist' | 'whitelist';
  /** Column width overrides keyed by property key */
  columnWidths?: Record<string, number>;
  /** Group by property key */
  groupBy?: string;
  /** Property key used for date-based views (calendar / timeline) */
  datePropertyKey?: string;
  /** Default calendar view granularity */
  defaultCalendarView?: string;
  /** Whether to show recurring events in calendar views */
  showRecurring?: boolean;
}

/**
 * View response (a saved view configuration for a channel)
 */
export interface ViewResponse {
  /** View ID */
  id: string;
  /** Channel this view belongs to */
  channelId: string;
  /** View name */
  name: string;
  /** View type (e.g. table, board, calendar) */
  type: string;
  /** View configuration */
  config: ViewConfig;
  /** Display order */
  order: number;
  /** Who created this view */
  createdBy: string | null;
  /** Created at */
  createdAt: string;
  /** Updated at */
  updatedAt: string;
}

// ==================== Tab Types ====================

/**
 * Tab response (a tab grouping views in a channel)
 */
export interface TabResponse {
  /** Tab ID */
  id: string;
  /** Channel this tab belongs to */
  channelId: string;
  /** Tab name */
  name: string;
  /** Tab type (e.g. chat, view) */
  type: string;
  /** Associated view ID (for view-type tabs) */
  viewId: string | null;
  /** Whether this is a built-in tab */
  isBuiltin: boolean;
  /** Display order */
  order: number;
  /** Who created this tab */
  createdBy: string | null;
  /** Created at */
  createdAt: string;
  /** Updated at */
  updatedAt: string;
}

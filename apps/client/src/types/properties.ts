// Property system types for message properties, views, tabs, and audit logs

// ==================== Property Value Types ====================

export type PropertyValueType =
  | "text"
  | "number"
  | "boolean"
  | "single_select"
  | "multi_select"
  | "person"
  | "date"
  | "timestamp"
  | "date_range"
  | "timestamp_range"
  | "recurring"
  | "url"
  | "message_ref"
  | "file"
  | "image"
  | "tags";

// ==================== Select Option ====================

export interface SelectOption {
  value: string;
  label: string;
  color?: string;
}

// ==================== Property Definition ====================

export interface PropertyDefinition {
  id: string;
  channelId: string;
  key: string;
  description: string | null;
  valueType: PropertyValueType;
  isNative: boolean;
  config: Record<string, unknown>;
  order: number;
  aiAutoFill: boolean;
  aiAutoFillPrompt: string | null;
  isRequired: boolean;
  defaultValue: unknown;
  showInChatPolicy: string;
  allowNewOptions: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

// ==================== Message Property Values ====================

export interface MessagePropertyValue {
  definitionId: string;
  value: unknown;
}

export type MessagePropertiesMap = Record<string, unknown>;

// ==================== View Types ====================

export type ViewType = "table" | "board" | "calendar";

export type ViewFilterOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "contains"
  | "not_contains"
  | "is_empty"
  | "is_not_empty"
  | "in"
  | "not_in";

export type ViewSortDirection = "asc" | "desc";

export interface ViewFilter {
  propertyKey: string;
  operator: ViewFilterOperator;
  value?: unknown;
}

export interface ViewSort {
  propertyKey: string;
  direction: ViewSortDirection;
}

export interface ViewConfig {
  filters?: ViewFilter[];
  sorts?: ViewSort[];
  visibleProperties?: string[];
  groupBy?: string;
  columnWidths?: Record<string, number>;
  datePropertyKey?: string;
  defaultCalendarView?: "month" | "week" | "day";
}

export interface ChannelView {
  id: string;
  channelId: string;
  name: string;
  type: string;
  config: ViewConfig;
  order: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

// ==================== Tab Types ====================

export type TabType =
  | "messages"
  | "files"
  | "table_view"
  | "board_view"
  | "calendar_view";

export interface ChannelTab {
  id: string;
  channelId: string;
  name: string;
  type: string;
  viewId: string | null;
  isBuiltin: boolean;
  order: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

// ==================== View Messages Response ====================

export interface ViewMessageItem {
  id: string;
  channelId: string;
  senderId: string | null;
  parentId: string | null;
  rootId: string | null;
  content: string | null;
  type: string;
  isPinned: boolean;
  isEdited: boolean;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
  properties: Record<string, unknown>;
}

export interface ViewMessagesGroup {
  groupKey: string;
  messages: ViewMessageItem[];
  total: number;
}

export interface ViewMessagesFlatResponse {
  messages: ViewMessageItem[];
  total: number;
  cursor: string | null;
}

export interface ViewMessagesGroupedResponse {
  groups: ViewMessagesGroup[];
  total: number;
}

export type ViewMessagesResponse =
  | ViewMessagesFlatResponse
  | ViewMessagesGroupedResponse;

// ==================== Audit Log Types ====================

export interface AuditLog {
  id: string;
  channelId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  changes: Record<string, { old: unknown; new: unknown }>;
  performedBy: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface AuditLogsResponse {
  logs: AuditLog[];
  nextCursor: string | null;
}

// ==================== DTO Types (for API requests) ====================

export interface CreatePropertyDefinitionDto {
  key: string;
  valueType: PropertyValueType;
  description?: string;
  config?: Record<string, unknown>;
  aiAutoFill?: boolean;
  aiAutoFillPrompt?: string;
  isRequired?: boolean;
  defaultValue?: unknown;
  showInChatPolicy?: string;
  allowNewOptions?: boolean;
}

export interface UpdatePropertyDefinitionDto {
  description?: string;
  config?: Record<string, unknown>;
  aiAutoFill?: boolean;
  aiAutoFillPrompt?: string;
  isRequired?: boolean;
  defaultValue?: unknown;
  showInChatPolicy?: string;
  allowNewOptions?: boolean;
}

export interface SetPropertyValueDto {
  value: unknown;
}

export interface BatchSetPropertyEntry {
  key: string;
  value: unknown;
}

export interface CreateViewDto {
  name: string;
  type: ViewType;
  config?: ViewConfig;
}

export interface UpdateViewDto {
  name?: string;
  order?: number;
  config?: ViewConfig;
}

export interface ViewMessageParams {
  limit?: number;
  cursor?: string;
  group?: string;
}

export interface CreateTabDto {
  name: string;
  type: TabType;
  viewId?: string;
}

export interface UpdateTabDto {
  name?: string;
  order?: number;
}

export interface AuditLogParams {
  limit?: number;
  cursor?: string;
  entityType?: string;
  action?: string;
}

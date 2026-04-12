# Message Properties — Review Fixes TODO

## P0: Tests

- [ ] **T1**: Backend — PropertyDefinitionsService unit tests (CRUD, duplicate key, native protection, seedNativeProperties, findOrCreate, channel isolation)
- [ ] **T2**: Backend — MessagePropertiesService unit tests (getProperties, setProperty type validation, removeProperty, batchSet, allowNonAdminCreateKey check, showInChatPolicy filter, falsy values like `false`/`0`)
- [ ] **T3**: Backend — AuditService unit tests (log, findByChannel pagination, entityType/action filtering)
- [ ] **T4**: Backend — ViewsService unit tests (CRUD, config validation, queryMessages with filters/sorts/groupBy, grouped pagination, view limit 20)
- [ ] **T5**: Backend — TabsService unit tests (CRUD, builtin protection, seedBuiltinTabs, viewId ownership check)
- [ ] **T6**: Backend — AiAutoFillService unit tests (prompt building, response parsing, validation, retry, selective fields, audit metadata)
- [ ] **T7**: Backend — Controller integration tests (property-definitions, message-properties, views, tabs, audit-logs — auth guards, channel isolation, request validation)
- [ ] **T8**: Frontend — PropertyEditor component tests (each of 16 editors: render, onChange, validation)
- [ ] **T9**: Frontend — MessageProperties/PropertyTag/PropertyValue render tests (showInChatPolicy, key-based value lookup, structured value display)
- [ ] **T10**: Frontend — PropertySelector/PropertyPanel tests (open/close, search, set/remove property, collapse logic)
- [ ] **T11**: Frontend — TableView/BoardView/CalendarView render tests (columns, grouping, cell display)
- [ ] **T12**: Frontend — Hook tests (usePropertyDefinitions, useMessageProperties, useChannelViews, useChannelTabs — query/mutation/WS invalidation)

## P1: Correctness Bugs

- [ ] **T13**: DB — Add CHECK constraint on `message_properties` (only one value column non-NULL per row) via new migration
- [ ] **T14**: DB — Add CHECK constraint on `show_in_chat_policy` column (`'show'`, `'auto'`, `'hide'` only)
- [ ] **T15**: Backend — Audit system messages in thread view (property changes appear as system-like entries in thread replies)
- [ ] **T16**: Backend — Audit filter DTO: add enum validation for `entityType` and `action` params
- [ ] **T17**: Backend — Fix `inferValueType()` in message-properties.service.ts (handle arrays → multi_select, objects with start/end → date_range, etc.)
- [ ] **T18**: Backend — AI auto-fill: expand tool schema to all field types, use spec action `property_set` in audit, make endpoint async (return 202)
- [ ] **T19**: Backend — Tabs: validate viewId belongs to same channel on tab creation
- [ ] **T20**: Frontend — WS events should also invalidate active view queries (not just messages)
- [ ] **T21**: Frontend — SelectEditor: persist new options to schema config via updateDefinition mutation
- [ ] **T22**: Frontend — PropertySchemaManager: allow editing aiAutoFill/showInChatPolicy/description on native properties

## P2: Missing UI Features

- [ ] **T23**: Frontend — Table View: add "+" new message row at bottom
- [ ] **T24**: Frontend — Table View: column header click-to-sort, drag-to-resize, drag-to-reorder
- [ ] **T25**: Frontend — Table View: infinite scroll / cursor pagination
- [ ] **T26**: Frontend — Board View: drag-and-drop cards between columns (update groupBy property)
- [ ] **T27**: Frontend — Board View: real "+ Add" card flow (create message with pre-filled group value)
- [ ] **T28**: Frontend — Calendar View: add week and day view modes
- [ ] **T29**: Frontend — Calendar View: date_range cross-date bars, recurring expansion
- [ ] **T30**: Frontend — Calendar View: click empty date to create message, drag card to reschedule
- [ ] **T31**: Frontend — Channel Tabs: drag-to-reorder tabs
- [ ] **T32**: Frontend — Files tab: render actual file list (not placeholder)

## P3: Settings & Polish

- [ ] **T33**: Frontend — Channel settings UI: `allowNonAdminCreateKey` toggle and `propertyDisplayOrder` selector
- [ ] **T34**: Frontend — Chat view: respect `propertyDisplayOrder` channel setting for chip ordering
- [ ] **T35**: Frontend — PropertySchemaManager: drag-to-reorder definitions
- [ ] **T36**: Frontend — AI auto-fill UI: retry round indicator, failure badge, title generate button in Table View
- [ ] **T37**: Frontend — Tab icons: derive from view.type instead of tab name
- [ ] **T38**: Frontend — FileUploader editor: real file upload integration (not stub)
- [ ] **T39**: Frontend — MessageRefPicker editor: message search instead of raw ID input

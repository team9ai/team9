# Message Properties — Structured Property System for Messages

## Overview

Add a structured property system to group channel messages in Team9, allowing each message to carry tags, key-value pairs, and other structured data beyond reactions. Properties share a channel-level schema and power Table View, Board View, and Calendar View.

### Core Vision

**Channels are the communication bus between agents; structured properties are the signal protocol.**

Message `content` is for humans (natural language); `properties` are for machines (structured data). Humans and agents share the same channel — humans see the global structured state via table/board/calendar views, agents consume and respond to signals via subscribe + query.

### Design Philosophy

- **Schema-on-write**: Property definitions are created automatically on first use — zero friction creation, post-hoc governance
- **Unified model**: Native properties (tags/people/tasks/messages) and custom properties share the same EAV system
- **Channel as database**: Table/Board/Calendar Views upgrade channels from timeline chat to structured collaboration spaces
- **Agent-first**: The property system is designed for agent signal communication; the human UI is the visualization layer

## Scope

### Supported Channel Types

- `public` (group) ✅
- `private` (private group) ✅
- `direct` (DM) ❌
- `task` ❌
- `tracking` ❌

### Supported Message Scope

- Root messages (non-thread replies) ✅
- Thread replies ❌
- `text` / `long_text` / `file` / `image` types ✅
- `system` / `tracking` types ❌

## Data Model

### Value Types (16 types)

| #   | Type              | Storage Column         | Description                                      |
| --- | ----------------- | ---------------------- | ------------------------------------------------ |
| 1   | `text`            | textValue              | Plain text                                       |
| 2   | `number`          | numberValue            | Numeric value                                    |
| 3   | `boolean`         | booleanValue           | True/false                                       |
| 4   | `single_select`   | textValue              | Single selection                                 |
| 5   | `multi_select`    | jsonValue              | Multiple selection                               |
| 6   | `person`          | jsonValue              | User reference(s)                                |
| 7   | `date`            | dateValue              | Date only                                        |
| 8   | `timestamp`       | dateValue              | Date + time                                      |
| 9   | `date_range`      | jsonValue              | Date span `{ "start": "...", "end": "..." }`     |
| 10  | `timestamp_range` | jsonValue              | Datetime span `{ "start": "...", "end": "..." }` |
| 11  | `recurring`       | jsonValue              | Recurring rule (simplified iCal RRULE)           |
| 12  | `url`             | textValue              | URL link                                         |
| 13  | `message_ref`     | jsonValue              | Reference to another message                     |
| 14  | `file`            | fileKey + fileMetadata | File upload                                      |
| 15  | `image`           | fileKey + fileMetadata | Image upload                                     |
| 16  | `tags`            | —                      | Native multi_select syntactic sugar              |

### `channel_property_definitions` Table

Channel-level property schema definitions.

| Field              | Type                  | Description                                                                   |
| ------------------ | --------------------- | ----------------------------------------------------------------------------- |
| `id`               | UUID PK               | —                                                                             |
| `channelId`        | UUID FK → channels    | —                                                                             |
| `key`              | varchar(100)          | Property name, unique per channel. `_` prefix reserved for native properties  |
| `description`      | text, nullable        | Property description                                                          |
| `valueType`        | enum                  | One of the 16 types above                                                     |
| `isNative`         | boolean               | Native properties cannot be deleted or have their type changed                |
| `config`           | JSONB                 | Type-specific configuration (see below)                                       |
| `order`            | integer               | Sort order within channel (native properties first)                           |
| `aiAutoFill`       | boolean               | Whether AI auto-fill is enabled                                               |
| `aiAutoFillPrompt` | text, nullable        | Custom prompt for AI fill                                                     |
| `isRequired`       | boolean               | Whether the property is required                                              |
| `defaultValue`     | JSONB, nullable       | Default value                                                                 |
| `showInChatPolicy` | varchar(20)           | `"auto"` / `"show"` / `"hide"`, default `"auto"`                              |
| `allowNewOptions`  | boolean, default true | For single_select / multi_select only: whether new option values can be added |
| `createdBy`        | UUID FK → users       | —                                                                             |
| `createdAt`        | timestamp             | —                                                                             |
| `updatedAt`        | timestamp             | —                                                                             |

**Unique constraint:** `(channelId, key)`

**`config` JSONB structure (by type):**

- **single_select / multi_select:** `{ "options": [{ "value": "todo", "color": "#ff0000" }, ...] }`
- **person:** `{ "multiple": true/false }`
- **number:** `{ "format": "number" | "percent" | "currency" }`
- **date / timestamp:** `{ "includeTime": false }`
- **file / image:** `{ "maxSize": 10485760, "allowedMimeTypes": [...] }`
- Others: `{}`

**Native properties (auto-inserted on channel creation):**

| key         | valueType      | isNative | aiAutoFill default |
| ----------- | -------------- | -------- | ------------------ |
| `_tags`     | `multi_select` | true     | true               |
| `_people`   | `person`       | true     | true               |
| `_tasks`    | `message_ref`  | true     | true               |
| `_messages` | `message_ref`  | true     | true               |

Special field `title` (not native, but has special display logic; aiAutoFill defaults to false).

### `message_properties` Table

Message-level property values. One row per property per message.

| Field                  | Type                                   | Description                                                                                     |
| ---------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `id`                   | UUID PK                                | —                                                                                               |
| `messageId`            | UUID FK → messages (cascade)           | —                                                                                               |
| `propertyDefinitionId` | UUID FK → channel_property_definitions | —                                                                                               |
| `textValue`            | text, nullable                         | For text / url / single_select                                                                  |
| `numberValue`          | double precision, nullable             | For number                                                                                      |
| `booleanValue`         | boolean, nullable                      | For boolean                                                                                     |
| `dateValue`            | timestamp, nullable                    | For date / timestamp                                                                            |
| `jsonValue`            | JSONB, nullable                        | For array types (multi_select, person[], message_ref[], date_range, timestamp_range, recurring) |
| `fileKey`              | varchar(500), nullable                 | For file / image storage key                                                                    |
| `fileMetadata`         | JSONB, nullable                        | `{ "fileName", "fileUrl", "fileSize", "mimeType", "width", "height" }`                          |
| `order`                | integer                                | Display order of this property on the message                                                   |
| `createdBy`            | UUID FK → users                        | —                                                                                               |
| `updatedBy`            | UUID FK → users, nullable              | —                                                                                               |
| `createdAt`            | timestamp                              | —                                                                                               |
| `updatedAt`            | timestamp                              | —                                                                                               |

**Unique constraint:** `(messageId, propertyDefinitionId)`

**CHECK constraint:** Only one value column may be non-NULL per row (determined by the linked definition's valueType).

**Indexes:**

- `(messageId)` — load message properties
- `(propertyDefinitionId, textValue)` — text filtering
- `(propertyDefinitionId, numberValue)` — numeric sort/range queries
- `(propertyDefinitionId, dateValue)` — date sort/range queries
- `(propertyDefinitionId, booleanValue)` — boolean filtering
- `jsonValue` GIN — array containment queries

### `audit_logs` Table

General-purpose audit log covering all changes to channels, messages, and their properties.

| Field         | Type                         | Description                                    |
| ------------- | ---------------------------- | ---------------------------------------------- |
| `id`          | UUID PK                      | —                                              |
| `channelId`   | UUID FK → channels, nullable | Owning channel                                 |
| `entityType`  | varchar(50)                  | `"channel"` / `"message"`                      |
| `entityId`    | UUID                         | ID of the modified entity                      |
| `action`      | varchar(50)                  | See table below                                |
| `changes`     | JSONB                        | `{ "field": { "old": ..., "new": ... }, ... }` |
| `performedBy` | UUID FK → users, nullable    | Actor                                          |
| `metadata`    | JSONB, nullable              | Extra info (e.g., AI fill source)              |
| `createdAt`   | timestamp                    | —                                              |

**Action values:**

| entityType | action                    | Scenario                              |
| ---------- | ------------------------- | ------------------------------------- |
| `channel`  | `updated`                 | Channel settings changed              |
| `channel`  | `property_defined`        | New property definition created       |
| `channel`  | `property_schema_updated` | Property definition modified          |
| `channel`  | `property_deleted`        | Property definition deleted           |
| `message`  | `created`                 | Message created                       |
| `message`  | `updated`                 | Message content edited                |
| `message`  | `deleted`                 | Message deleted                       |
| `message`  | `property_set`            | Property value set for the first time |
| `message`  | `property_updated`        | Property value modified               |
| `message`  | `property_removed`        | Property value removed                |

**AI operation metadata example:**

```json
{
  "source": "ai_auto_fill",
  "model": "claude-sonnet-4-6",
  "round": 1
}
```

**Indexes:**

- `(channelId, createdAt)` — channel audit queries
- `(entityType, entityId)` — entity change history
- `(performedBy, createdAt)` — user activity queries

### `channel_views` Table

| Field       | Type                         | Description                                                 |
| ----------- | ---------------------------- | ----------------------------------------------------------- |
| `id`        | UUID PK                      | —                                                           |
| `channelId` | UUID FK → channels (cascade) | —                                                           |
| `name`      | varchar(100)                 | View name                                                   |
| `type`      | varchar(20)                  | `"table"` / `"board"` / `"calendar"`                        |
| `config`    | JSONB                        | Filters, sorts, grouping, visible columns, etc. (see below) |
| `order`     | integer                      | Tab ordering                                                |
| `createdBy` | UUID FK → users              | —                                                           |
| `createdAt` | timestamp                    | —                                                           |
| `updatedAt` | timestamp                    | —                                                           |

**`config` JSONB:**

```json
{
  "filters": [
    { "propertyKey": "status", "operator": "eq", "value": "in-progress" },
    { "propertyKey": "priority", "operator": "gte", "value": 3 }
  ],
  "sorts": [{ "propertyKey": "priority", "direction": "desc" }],
  "groupBy": "status",
  "visiblePropertiesMode": "blacklist",
  "visibleProperties": [],
  "columnWidths": { "priority": 100, "status": 150 },
  "datePropertyKey": "deadline",
  "defaultCalendarView": "month",
  "showRecurring": true
}
```

**Filter operators:** `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `contains`, `not_contains`, `is_empty`, `is_not_empty`, `in`

**Limits:** filter conditions ≤ 10, sort fields ≤ 3.

### `channel_tabs` Table

| Field       | Type                              | Description                                                                    |
| ----------- | --------------------------------- | ------------------------------------------------------------------------------ |
| `id`        | UUID PK                           | —                                                                              |
| `channelId` | UUID FK → channels (cascade)      | —                                                                              |
| `name`      | varchar(100)                      | Tab display name                                                               |
| `type`      | varchar(30)                       | `"messages"` / `"files"` / `"table_view"` / `"board_view"` / `"calendar_view"` |
| `viewId`    | UUID FK → channel_views, nullable | Links to view config for view-type tabs                                        |
| `isBuiltin` | boolean                           | Built-in tabs cannot be deleted                                                |
| `order`     | integer                           | Sort order                                                                     |
| `createdBy` | UUID FK → users, nullable         | —                                                                              |
| `createdAt` | timestamp                         | —                                                                              |
| `updatedAt` | timestamp                         | —                                                                              |

**Auto-inserted on channel creation:**

| name     | type       | isBuiltin | order |
| -------- | ---------- | --------- | ----- |
| Messages | `messages` | true      | 0     |
| Files    | `files`    | true      | 1     |

### Channel Settings Extension

New `propertySettings` JSONB column on the `channels` table:

```json
{
  "allowNonAdminCreateKey": true,
  "propertyDisplayOrder": "schema"
}
```

| Setting                  | Default    | Description                                                          |
| ------------------------ | ---------- | -------------------------------------------------------------------- |
| `allowNonAdminCreateKey` | `true`     | Whether non-admins can create new property keys                      |
| `propertyDisplayOrder`   | `"schema"` | `"schema"` (by schema order) / `"chronological"` (by addition order) |

## Permissions

Permissions follow channel roles. Core principle: **if you can send messages, you can operate properties; schema management is available to all writable members.**

| Channel Type                 | Role              | Send Messages | Set/Remove Properties | Manage Schema |
| ---------------------------- | ----------------- | ------------- | --------------------- | ------------- |
| **Public** (default)         | All members       | ✅            | ✅                    | ✅            |
| **Public** (admin-only send) | Regular members   | ❌            | ❌                    | ❌            |
| **Public** (admin-only send) | admin/owner       | ✅            | ✅                    | ✅            |
| **Private**                  | Read-only members | ❌            | ❌                    | ❌            |
| **Private**                  | Writable members  | ✅            | ✅                    | ✅            |
| **Private**                  | admin/owner       | ✅            | ✅                    | ✅            |

**Content vs Properties permission distinction:**

- Edit Content: message sender only
- Delete message: sender + admin/owner
- Edit Properties: all members with write permission (including on others' messages)

## API

### Property Schema Management

| Method   | Endpoint                                                | Description                                               |
| -------- | ------------------------------------------------------- | --------------------------------------------------------- |
| `GET`    | `/v1/im/channels/:channelId/property-definitions`       | List all property definitions for a channel               |
| `POST`   | `/v1/im/channels/:channelId/property-definitions`       | Create a property definition                              |
| `PATCH`  | `/v1/im/channels/:channelId/property-definitions/:id`   | Update a property definition                              |
| `DELETE` | `/v1/im/channels/:channelId/property-definitions/:id`   | Delete a property definition (isNative cannot be deleted) |
| `PATCH`  | `/v1/im/channels/:channelId/property-definitions/order` | Batch reorder definitions                                 |

### Message Property Values

| Method   | Endpoint                                              | Description                        |
| -------- | ----------------------------------------------------- | ---------------------------------- |
| `GET`    | `/v1/im/messages/:messageId/properties`               | Get all properties for a message   |
| `PUT`    | `/v1/im/messages/:messageId/properties/:definitionId` | Set/update a single property value |
| `DELETE` | `/v1/im/messages/:messageId/properties/:definitionId` | Remove a property value            |
| `PATCH`  | `/v1/im/messages/:messageId/properties`               | Batch set properties               |
| `POST`   | `/v1/im/messages/:messageId/properties/auto-fill`     | Trigger AI auto-fill               |

**Batch set body:**

```json
{
  "properties": [
    { "key": "priority", "value": 3 },
    { "key": "status", "value": "in-progress" },
    { "key": "_tags", "value": ["urgent", "bug"] }
  ]
}
```

**AI auto-fill body:**

```json
{
  "fields": ["title", "status"],
  "preserveExisting": true
}
```

`fields` is optional — omit to generate all `aiAutoFill=true` fields. `preserveExisting` is true for manual triggers.

### Channel Views

| Method   | Endpoint                                            | Description                  |
| -------- | --------------------------------------------------- | ---------------------------- |
| `GET`    | `/v1/im/channels/:channelId/views`                  | List all views for a channel |
| `POST`   | `/v1/im/channels/:channelId/views`                  | Create a view                |
| `PATCH`  | `/v1/im/channels/:channelId/views/:viewId`          | Update view config           |
| `DELETE` | `/v1/im/channels/:channelId/views/:viewId`          | Delete a view                |
| `GET`    | `/v1/im/channels/:channelId/views/:viewId/messages` | Query view data (paginated)  |

**View data query — grouped pagination response:**

```json
{
  "groups": [
    {
      "value": "todo",
      "total": 45,
      "cursor": "next-cursor-todo",
      "messages": [
        {
          "id": "msg-uuid",
          "content": "Login page has a bug...",
          "sender": { "id": "...", "displayName": "Alice" },
          "createdAt": "2026-04-11T10:00:00Z",
          "properties": {
            "priority": 3,
            "status": "todo",
            "_tags": ["urgent", "bug"],
            "_people": [{ "id": "user-1", "displayName": "Bob" }]
          }
        }
      ]
    }
  ]
}
```

Each group has independent cursor + total; frontend lazy-loads per group.

### Channel Tabs

| Method   | Endpoint                                 | Description                                |
| -------- | ---------------------------------------- | ------------------------------------------ |
| `GET`    | `/v1/im/channels/:channelId/tabs`        | List all tabs for a channel                |
| `POST`   | `/v1/im/channels/:channelId/tabs`        | Create a tab                               |
| `PATCH`  | `/v1/im/channels/:channelId/tabs/:tabId` | Update a tab                               |
| `DELETE` | `/v1/im/channels/:channelId/tabs/:tabId` | Delete a tab (isBuiltin cannot be deleted) |
| `PATCH`  | `/v1/im/channels/:channelId/tabs/order`  | Batch reorder tabs                         |

### Audit Logs

| Method | Endpoint                                | Description                                                           |
| ------ | --------------------------------------- | --------------------------------------------------------------------- |
| `GET`  | `/v1/im/channels/:channelId/audit-logs` | Query channel audit logs (paginated, filterable by entityType/action) |

### Changes to Existing Message API

`GET /v1/im/channels/:channelId/messages` — each message in the response gains a `properties` field (only returns properties where `showInChatPolicy !== "hide"`).

`POST /v1/im/channels/:channelId/messages` — body extended with optional `properties` field to set properties alongside message creation.

## WebSocket Events

### Server → Client (broadcast to channel members)

| Event                         | Payload                                             | Scenario                                            |
| ----------------------------- | --------------------------------------------------- | --------------------------------------------------- |
| `property_definition_created` | `{ channelId, definition }`                         | New property definition (including schema-on-write) |
| `property_definition_updated` | `{ channelId, definitionId, changes }`              | Property schema changed                             |
| `property_definition_deleted` | `{ channelId, definitionId }`                       | Property definition deleted                         |
| `message_property_changed`    | `{ channelId, messageId, properties, performedBy }` | Message property values changed (unified event)     |
| `view_created`                | `{ channelId, view }`                               | View created                                        |
| `view_updated`                | `{ channelId, viewId, changes }`                    | View config changed                                 |
| `view_deleted`                | `{ channelId, viewId }`                             | View deleted                                        |
| `tab_created`                 | `{ channelId, tab }`                                | Tab created                                         |
| `tab_updated`                 | `{ channelId, tabId, changes }`                     | Tab changed                                         |
| `tab_deleted`                 | `{ channelId, tabId }`                              | Tab deleted                                         |

**`message_property_changed` payload:**

```json
{
  "channelId": "ch-uuid",
  "messageId": "msg-uuid",
  "properties": {
    "set": { "priority": 3, "status": "in-progress" },
    "removed": ["_tags"]
  },
  "performedBy": "user-uuid"
}
```

Uses a unified `message_property_changed` event rather than separate set/update/remove events — batch operations (AI auto-fill) may set several and remove some simultaneously; a single event is more efficient.

## AI Auto-Fill

### Trigger Conditions

- After message creation (automatic, if any fields have `aiAutoFill=true`)
- After message edit (automatic, with diff)
- Manual request (specify `fields`, `preserveExisting: true`)
- Click title generation button in Table View

### Prompt Format (XML)

```xml
<context>
  <channel>
    <name>Frontend Bug Tracker</name>
    <description>Frontend bug tracking and fixes</description>
  </channel>

  <message>
    <content>Login page CSS is misaligned on Safari, users cannot click the submit button.</content>
    <original_content>Login page has a bug</original_content>  <!-- present on edit trigger -->
    <reactions>
      <reaction emoji="👀" count="2" />
      <reaction emoji="👍" count="1" />
    </reactions>
    <thread_replies>
      <reply sender="Bob">Let me look into this</reply>
      <reply sender="Carol">Safari doesn't support the flexbox gap property</reply>
    </thread_replies>
  </message>

  <current_properties>
    <property key="priority" type="number">2</property>
    <property key="_tags" type="multi_select">
      <value>bug</value>
    </property>
  </current_properties>

  <channel_schema>
    <property key="title" type="text" required="false" ai_fill="true" />
    <property key="priority" type="number" required="false" ai_fill="true" />
    <property key="status" type="single_select" ai_fill="true" allow_new_options="false">
      <option>todo</option>
      <option>in-progress</option>
      <option>done</option>
    </property>
    <property key="_tags" type="multi_select" ai_fill="true" allow_new_options="true" />
  </channel_schema>

  <generate_fields>  <!-- only present for manual/selective generation -->
    <field>title</field>
    <field>status</field>
  </generate_fields>
</context>

<instructions>
  Based on the message content, channel context, thread replies, and current properties,
  generate appropriate values for the specified fields.
  - Mark fields that don't need changes as unchanged
  - For allow_new_options="false" fields, only use existing options; return null if no match
  - Only modify fields with ai_fill="true"
</instructions>
```

### AI Response Format (function_call JSON)

```json
{
  "title": { "value": "Login page CSS misalignment" },
  "status": { "value": "todo" },
  "priority": { "unchanged": true },
  "_tags": { "value": ["bug", "frontend"] },
  "_people": { "value": null }
}
```

- `{ "unchanged": true }` — no update needed
- `{ "value": ... }` — set new value
- `{ "value": null }` — cannot generate / no matching option

### Required/Nullable Rules

| Condition                                                    | Can value be null?        |
| ------------------------------------------------------------ | ------------------------- |
| `aiAutoFill=true` and not yet set                            | Must return (can be null) |
| `allowNewOptions=false` and no matching option               | Can be null               |
| `allowNewOptions=true` and `aiAutoFill=true` and not yet set | Cannot be null            |
| `aiAutoFill=false`                                           | AI cannot modify          |

### Native Property Default AI Fill Config

| Property                        | aiAutoFill default |
| ------------------------------- | ------------------ |
| `title`                         | false              |
| `_tags`                         | true               |
| `_people`                       | true               |
| `_tasks`                        | true               |
| `_messages`                     | true               |
| Custom properties (on creation) | true               |

### Error Retry

Validate return values (type matching, option existence, required fields, only modifying `aiAutoFill=true` fields). On failure, return error details to AI for retry — max 3 rounds. Final failure is logged.

AI fill results are recorded in `audit_logs` with `performedBy=null` and `metadata.source="ai_auto_fill"`.

## Frontend Architecture

### Component Structure

```
channel/
├── ChannelHeader.tsx (existing)
│   └── ChannelTabs.tsx (new)              ← tab bar: Messages | Files | Views...
│
├── MessageList.tsx (existing, extended)
│   └── MessageItem.tsx (existing, extended)
│       ├── MessageContent.tsx (existing)
│       ├── MessageTitle.tsx (new)          ← title special field
│       ├── MessageProperties.tsx (new)     ← property chips below message
│       │   ├── PropertyTag.tsx
│       │   ├── PropertyPerson.tsx
│       │   ├── PropertyValue.tsx
│       │   └── PropertyMoreButton.tsx     ← [...] expand more
│       ├── MessageReactions.tsx (existing)
│       └── MessageHoverToolbar.tsx (existing, extended)
│           └── + property button
│
├── views/ (new)
│   ├── TableView.tsx
│   │   ├── TableHeader.tsx
│   │   ├── TableRow.tsx
│   │   ├── TableCell.tsx                  ← renders editor by type
│   │   └── TableAddRow.tsx                ← "+" add new message row
│   ├── BoardView.tsx
│   │   ├── BoardColumn.tsx                ← group column, independent scroll/pagination
│   │   └── BoardCard.tsx
│   ├── CalendarView.tsx
│   │   ├── CalendarMonth.tsx
│   │   ├── CalendarWeek.tsx
│   │   ├── CalendarDay.tsx
│   │   └── CalendarEventCard.tsx
│   └── ViewConfigPanel.tsx
│
├── properties/ (new)
│   ├── PropertyEditor.tsx                 ← dispatches by type
│   │   ├── TextEditor / NumberEditor / BooleanEditor
│   │   ├── SelectEditor                   ← single/multi select + create new option
│   │   ├── PersonPicker / DatePicker
│   │   ├── UrlEditor / MessageRefPicker / FileUploader
│   │   └── RecurringEditor
│   ├── PropertyPanel.tsx                  ← message property sidebar
│   ├── PropertySelector.tsx               ← property picker (sub-menu pattern)
│   └── PropertySchemaManager.tsx          ← schema management in channel settings
│
└── settings/ (existing, extended)
    └── ChannelSettings.tsx → + PropertySchemaManager tab
```

### State Management

**React Query (server state):**

| Query Key                                            | Invalidation                                  |
| ---------------------------------------------------- | --------------------------------------------- |
| `["channel", channelId, "propertyDefinitions"]`      | WS `property_definition_*`                    |
| `["channel", channelId, "tabs"]`                     | WS `tab_*`                                    |
| `["channel", channelId, "view", viewId, "messages"]` | WS `message_property_changed` / `new_message` |

Message properties are loaded alongside messages (via `properties` field) — no extra queries needed.

**Zustand (UI state):**

```typescript
interface PropertyUIState {
  activeTab: string;
  propertyPanelMessageId: string | null;
  viewConfigOpen: boolean;
}
```

## UI Interaction

### Chat View — Property Display

**With properties:**

```
Message bubble
├── [Title] Login page CSS misalignment
├── Message body...
├── [🏷 urgent] [🏷 bug] [👤 Alice] [⚡ 3] [📋 todo] [...]  ← [...] at the end
└── [👍 2] [❤️ 1]
```

**Without properties:**

```
Message bubble
├── Message body...
└── [👍 2] [❤️ 1] [+]  ← [+] follows reactions
```

**showInChatPolicy control:**

- `"show"` — always visible
- `"auto"` — visible when value exists
- `"hide"` — only visible in PropertyPanel or Views

**Hover toolbar (top-right floating bar):**

```
[✅] [👀] [🙌] [😊] [💬] [📎] [🔖] [⋮]
 ↑──────────↑                  ↑
 Recently used emoji        Property button
```

### Property Selector — Sub-menu Pattern

```
[...] or [+] click
  ↓
┌─────────────────────┐
│ 🔍 Search...        │
├─────────────────────┤
│ 🏷 Tags         ▸  │──→ ┌──────────────────┐
│ 👤 People       ▸  │    │ Option sub-menu   │
│ priority        ▸  │    └──────────────────┘
│ status          ▸  │
├─────────────────────┤
│ [+ Create property] │  ← controlled by allowNonAdminCreateKey
└─────────────────────┘
```

### Message Detail View

**Regular message (with tags/properties):**

```
┌─────────────────────────────────────────────┐
│ [Title] Login page CSS misalignment [✨ AI] │
├─────────────────────────────────────────────┤
│ 🏷 urgent  🏷 bug  🏷 frontend  [+]         │  ← tags deletable (×)
├─────────────────────────────────────────────┤
│ Message body                                 │
│ Login page CSS is misaligned on Safari...    │
├─────────────────────────────────────────────┤
│ Properties (3/8)              [Expand all ▾] │
│ ┌──────────┬──────────────────┐              │  ← Notion-style table
│ │ Status   │ ● todo          │              │
│ │ Priority │ 3               │              │
│ │ Assignee │ 👤 Alice        │              │
│ └──────────┴──────────────────┘              │
├─────────────────────────────────────────────┤
│ Thread + property change records interleaved │
│  👤 Bob: Let me look into this               │
│  ⚙ Alice changed status from todo → progress│
│  ⚙ AI added _tags: css-fix                  │
└─────────────────────────────────────────────┘
```

**long_text message — properties before body:**

```
Title → Tags → Properties table → Message body (long text) → Thread
```

**No tags, no properties:**

Tag row and properties table are hidden; top-right shows [📎+] add button.

**Property collapse rules:**

- ≤ 5 rows: show all
- \> 5 rows: collapse, show only properties with values ("effective properties")
- If effective properties also exceed 5: show first 5 + `[Expand all (N)]`

### Table View

```
┌──────────────────────────────────────────────────────────────┐
│ [Filter ▾] [Sort ▾] [Group ▾] [Properties ▾]  [⚙ Settings] │
├────────┬──────────┬────────┬──────────┬───────┬─────────────┤
│ Title  │ Content  │ Status │ Priority │ Tags  │ Assignee    │
├────────┼──────────┼────────┼──────────┼───────┼─────────────┤
│ Login  │ Login... │ ● todo │    3     │ 🏷bug │ 👤 Alice    │
│ Feature│ Add da...│ ● done │    1     │ 🏷feat│ 👤 Bob      │
│ [+ New message]                                              │
└──────────────────────────────────────────────────────────────┘
```

- Cell click → inline edit
- Content column: editable by sender only, read-only for others
- Title column click → navigate to message detail
- With groupBy: each group paginates independently with its own cursor
- Column headers draggable for width and order

### Board View

```
┌─────────────┬─────────────┬─────────────┐
│   📋 Todo   │ 🔄 Progress │  ✅ Done     │
├─────────────┼─────────────┼─────────────┤
│ ┌─────────┐ │ ┌─────────┐ │ ┌─────────┐ │
│ │ Login   │ │ │ Feature │ │ │ Docs    │ │
│ │ 🏷bug    │ │ │ 🏷feat   │ │ │ 🏷docs  │ │
│ │ 👤Alice  │ │ │ 👤Bob    │ │ │ 👤Carol │ │
│ └─────────┘ │ └─────────┘ │ └─────────┘ │
│ [+ Add]     │ [+ Add]     │ [+ Add]     │
└─────────────┴─────────────┴─────────────┘
```

- Group by any single_select property
- Drag cards → change group property value
- Each column scrolls/paginates independently
- `[+ Add]` → create message with group value pre-filled

### Calendar View

- `date` / `timestamp` properties → card on corresponding date cell
- `date_range` / `timestamp_range` → cross-date bar
- `recurring` → repeated on each matching date
- Click empty date → create message with date pre-filled
- Drag card → change date
- Month/week/day granularity toggle

### AI Auto-Fill UI

```
After message send (auto-fill):
  Property area shows shimmer loading → AI values fade in
  Retry → "Retrying..." (max 3 rounds) → Failure → "AI fill failed" + manual entry

Manual trigger:
  Property chip ✨ icon / right-click "AI Generate"
  → Target field shows loading spinner → highlight animation on completion
```

## Agent Integration

> **TODO:** Agent integration requires more thorough discussion; to be designed separately. Below is a directional overview.

### Interaction Model Overview

- **Subscribe:** Agents listen for `message_property_changed` / `new_message` events via WebSocket
- **Query:** Agents filter messages by property values via REST API (reusing view query endpoints)
- **Write:** Agents can set properties when sending messages, or modify properties on existing messages
- Agent permissions are identical to regular users, determined by channel member role

### Agent Sending Messages with Properties

```json
// POST /v1/im/channels/:channelId/messages
{
  "content": "Code review complete, found 3 issues",
  "properties": {
    "_tags": ["code-review"],
    "status": "review-done",
    "issueCount": 3
  }
}
```

### Signal Pattern Examples

- **Task orchestration:** Agent A sends message with `status: pending` → Agent B picks it up → processes → sets `status: done` → Agent C aggregates results
- **State machine:** Each `status` change is a WebSocket event; agents execute logic based on state transitions

## Performance

### Query Strategy

- **Chat view:** Two-pass query — first fetch message IDs, then batch-load `message_properties WHERE messageId IN (...)`, merge on frontend. Consistent with existing reactions/attachments loading pattern.
- **Table/Board/Calendar View:** Cursor-based pagination with one LEFT JOIN per sorted/filtered property. With groupBy, each group paginates independently.

### Limits

| Item                             | Upper Bound |
| -------------------------------- | ----------- |
| Property definitions per channel | 50          |
| Property values per message      | 50          |
| Filter conditions per view       | 10          |
| Sort fields per view             | 3           |
| Options per multi_select/tags    | 200         |
| People per person property       | 50          |
| Views per channel                | 20          |

### Indexes

```sql
-- message_properties
(messageId)
(propertyDefinitionId, textValue)
(propertyDefinitionId, numberValue)
(propertyDefinitionId, dateValue)
(propertyDefinitionId, booleanValue)
jsonValue USING GIN

-- channel_property_definitions
(channelId, order)
(channelId, key) UNIQUE

-- audit_logs
(channelId, createdAt)
(entityType, entityId)
(performedBy, createdAt)
```

### Caching

| Item                     | Storage     | TTL             | Invalidation                      |
| ------------------------ | ----------- | --------------- | --------------------------------- |
| Channel property schema  | Redis       | 10min           | WS `property_definition_*` clears |
| View config              | Redis       | 10min           | WS `view_*` clears                |
| Frontend property schema | React Query | staleTime: 5min | WS event triggers refetch         |

Message property values are not cached separately — they follow the message loading/caching strategy.

## Edge Cases

| Scenario                                       | Handling                                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------------------------ |
| Delete property definition                     | Confirmation dialog → delete definition + cascade delete all message property values |
| Change property type                           | Prohibited. Must delete and recreate to change type                                  |
| Two users editing same property simultaneously | Last-write-wins; frontend syncs in real-time via WebSocket                           |
| Message deleted                                | Cascade delete properties (existing cascade mechanism)                               |
| Channel archived                               | Views/properties become read-only                                                    |
| Delete select option (in use)                  | Confirmation dialog; messages using that option have their value set to null         |
| Native properties                              | Cannot be deleted or have type changed                                               |
| Key naming conflicts                           | `_` prefix reserved for native properties; user-created keys cannot start with `_`   |

## Known Issues to Fix

- **P1:** Hover toolbar position is too close to the right edge
- **Bug:** Reactions are not displayed in message detail (message list view)
- **Note:** Announcement channels should use 📢 wireframe icon

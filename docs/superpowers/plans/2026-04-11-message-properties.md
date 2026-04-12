# Message Properties Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a structured property system to group channel messages — tags, key-value pairs (16 types), Table/Board/Calendar views, AI auto-fill, and channel tabs.

**Architecture:** Unified EAV model with typed value columns. Two new backend modules (properties, views) with REST + WebSocket APIs. Frontend extends MessageItem with property chips, adds three view components (Table/Board/Calendar) rendered in channel tabs. AI auto-fill uses function_call pattern with XML prompts and 3-round retry.

**Tech Stack:** NestJS, Drizzle ORM, PostgreSQL, React 19, TanStack React Query, Zustand, Tailwind CSS, Socket.io, Vercel AI SDK

**Spec:** `docs/superpowers/specs/2026-04-11-message-properties-design.md`

---

## File Structure

| Action | Path                                                                              | Responsibility                          |
| ------ | --------------------------------------------------------------------------------- | --------------------------------------- |
| Create | `apps/server/libs/database/src/schemas/im/channel-property-definitions.ts`        | Property definition schema              |
| Create | `apps/server/libs/database/src/schemas/im/message-properties.ts`                  | Message property value schema           |
| Create | `apps/server/libs/database/src/schemas/im/audit-logs.ts`                          | Audit log schema                        |
| Create | `apps/server/libs/database/src/schemas/im/channel-views.ts`                       | Channel view schema                     |
| Create | `apps/server/libs/database/src/schemas/im/channel-tabs.ts`                        | Channel tab schema                      |
| Modify | `apps/server/libs/database/src/schemas/im/index.ts`                               | Export new schemas                      |
| Modify | `apps/server/libs/database/src/schemas/im/channels.ts`                            | Add `propertySettings` JSONB column     |
| Create | `apps/server/libs/database/migrations/0034_message_properties.sql`                | Migration for all new tables            |
| Modify | `apps/server/libs/shared/src/events/event-names.ts`                               | Add PROPERTY, VIEW, TAB event constants |
| Create | `apps/server/libs/shared/src/events/domains/property.events.ts`                   | Property event payload types            |
| Create | `apps/server/libs/shared/src/types/property.types.ts`                             | Shared property types                   |
| Create | `apps/server/apps/gateway/src/im/properties/properties.module.ts`                 | Properties NestJS module                |
| Create | `apps/server/apps/gateway/src/im/properties/property-definitions.controller.ts`   | Property definitions REST API           |
| Create | `apps/server/apps/gateway/src/im/properties/property-definitions.service.ts`      | Property definitions business logic     |
| Create | `apps/server/apps/gateway/src/im/properties/property-definitions.service.spec.ts` | Tests                                   |
| Create | `apps/server/apps/gateway/src/im/properties/message-properties.controller.ts`     | Message properties REST API             |
| Create | `apps/server/apps/gateway/src/im/properties/message-properties.service.ts`        | Message properties business logic       |
| Create | `apps/server/apps/gateway/src/im/properties/message-properties.service.spec.ts`   | Tests                                   |
| Create | `apps/server/apps/gateway/src/im/properties/dto/`                                 | DTOs for property endpoints             |
| Create | `apps/server/apps/gateway/src/im/properties/ai-auto-fill.service.ts`              | AI auto-fill logic                      |
| Create | `apps/server/apps/gateway/src/im/properties/ai-auto-fill.service.spec.ts`         | Tests                                   |
| Create | `apps/server/apps/gateway/src/im/audit/audit.module.ts`                           | Audit NestJS module                     |
| Create | `apps/server/apps/gateway/src/im/audit/audit.service.ts`                          | Audit log service                       |
| Create | `apps/server/apps/gateway/src/im/audit/audit.controller.ts`                       | Audit log REST API                      |
| Create | `apps/server/apps/gateway/src/im/views/views.module.ts`                           | Views NestJS module                     |
| Create | `apps/server/apps/gateway/src/im/views/views.controller.ts`                       | Views REST API                          |
| Create | `apps/server/apps/gateway/src/im/views/views.service.ts`                          | Views business logic                    |
| Create | `apps/server/apps/gateway/src/im/views/views.service.spec.ts`                     | Tests                                   |
| Create | `apps/server/apps/gateway/src/im/views/tabs.controller.ts`                        | Tabs REST API                           |
| Create | `apps/server/apps/gateway/src/im/views/tabs.service.ts`                           | Tabs business logic                     |
| Create | `apps/server/apps/gateway/src/im/views/dto/`                                      | DTOs for view/tab endpoints             |
| Modify | `apps/server/apps/gateway/src/im/messages/messages.service.ts`                    | Include properties in message queries   |
| Modify | `apps/server/apps/gateway/src/im/messages/messages.controller.ts`                 | Accept properties in createMessage      |
| Modify | `apps/server/apps/gateway/src/im/messages/dto/create-message.dto.ts`              | Add optional properties field           |
| Modify | `apps/server/apps/gateway/src/im/websocket/websocket.gateway.ts`                  | Broadcast property/view/tab events      |
| Modify | `apps/server/apps/gateway/src/im/im.module.ts`                                    | Import new modules                      |
| Create | `apps/client/src/types/properties.ts`                                             | Frontend property types                 |
| Create | `apps/client/src/services/api/properties.ts`                                      | Property API client                     |
| Create | `apps/client/src/services/api/views.ts`                                           | Views/tabs API client                   |
| Create | `apps/client/src/hooks/usePropertyDefinitions.ts`                                 | Property schema hook                    |
| Create | `apps/client/src/hooks/useMessageProperties.ts`                                   | Message properties hook                 |
| Create | `apps/client/src/hooks/useChannelTabs.ts`                                         | Channel tabs hook                       |
| Create | `apps/client/src/hooks/useChannelViews.ts`                                        | Channel views hook                      |
| Create | `apps/client/src/components/channel/properties/MessageProperties.tsx`             | Property chips on messages              |
| Create | `apps/client/src/components/channel/properties/PropertyTag.tsx`                   | Tag chip component                      |
| Create | `apps/client/src/components/channel/properties/PropertyValue.tsx`                 | Generic property value display          |
| Create | `apps/client/src/components/channel/properties/PropertySelector.tsx`              | Property picker sub-menu                |
| Create | `apps/client/src/components/channel/properties/PropertyPanel.tsx`                 | Message detail property panel           |
| Create | `apps/client/src/components/channel/properties/PropertyEditor.tsx`                | Type-dispatching editor                 |
| Create | `apps/client/src/components/channel/properties/editors/`                          | Type-specific editors (13+ files)       |
| Create | `apps/client/src/components/channel/properties/PropertySchemaManager.tsx`         | Schema management in settings           |
| Create | `apps/client/src/components/channel/ChannelTabs.tsx`                              | Tab bar component                       |
| Create | `apps/client/src/components/channel/views/TableView.tsx`                          | Table view                              |
| Create | `apps/client/src/components/channel/views/BoardView.tsx`                          | Board view                              |
| Create | `apps/client/src/components/channel/views/CalendarView.tsx`                       | Calendar view                           |
| Create | `apps/client/src/components/channel/views/ViewConfigPanel.tsx`                    | View filter/sort/group config           |
| Create | `apps/client/src/components/channel/MessageTitle.tsx`                             | Title special field display             |
| Modify | `apps/client/src/components/channel/MessageItem.tsx`                              | Add MessageTitle + MessageProperties    |
| Modify | `apps/client/src/components/channel/MessageHoverToolbar.tsx`                      | Add property button                     |
| Modify | `apps/client/src/services/websocket/index.ts`                                     | Add property/view/tab event listeners   |
| Modify | `apps/client/src/hooks/useWebSocketEvents.ts`                                     | Handle property events                  |

---

### Task 0: Database Schemas & Migrations

**Goal:** Create all 5 new tables and modify channels table with Drizzle schemas and run migration.

**Files:**

- Create: `apps/server/libs/database/src/schemas/im/channel-property-definitions.ts`
- Create: `apps/server/libs/database/src/schemas/im/message-properties.ts`
- Create: `apps/server/libs/database/src/schemas/im/audit-logs.ts`
- Create: `apps/server/libs/database/src/schemas/im/channel-views.ts`
- Create: `apps/server/libs/database/src/schemas/im/channel-tabs.ts`
- Modify: `apps/server/libs/database/src/schemas/im/index.ts`
- Modify: `apps/server/libs/database/src/schemas/im/channels.ts`

**Acceptance Criteria:**

- [ ] All 5 new tables created with correct columns, types, constraints, and indexes
- [ ] `channels` table has new `propertySettings` JSONB column
- [ ] Unique constraints: `(channelId, key)` on definitions, `(messageId, propertyDefinitionId)` on properties
- [ ] Foreign keys with cascade deletes where specified
- [ ] GIN index on `jsonValue` column
- [ ] `pnpm db:generate && pnpm db:migrate` runs cleanly
- [ ] `pnpm build:server` succeeds

**Verify:** `pnpm db:push && pnpm build:server` → no errors

**Steps:**

- [ ] **Step 1: Create `channel-property-definitions.ts` schema**

```typescript
import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  pgEnum,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { channels } from "./channels.js";
import { users } from "./users.js";

export const propertyValueTypeEnum = pgEnum("property_value_type", [
  "text",
  "number",
  "boolean",
  "single_select",
  "multi_select",
  "person",
  "date",
  "timestamp",
  "date_range",
  "timestamp_range",
  "recurring",
  "url",
  "message_ref",
  "file",
  "image",
  "tags",
]);

export const channelPropertyDefinitions = pgTable(
  "im_channel_property_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom().notNull(),
    channelId: uuid("channel_id")
      .references(() => channels.id, { onDelete: "cascade" })
      .notNull(),
    key: varchar("key", { length: 100 }).notNull(),
    description: text("description"),
    valueType: propertyValueTypeEnum("value_type").notNull(),
    isNative: boolean("is_native").default(false).notNull(),
    config: jsonb("config")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    order: integer("order").default(0).notNull(),
    aiAutoFill: boolean("ai_auto_fill").default(true).notNull(),
    aiAutoFillPrompt: text("ai_auto_fill_prompt"),
    isRequired: boolean("is_required").default(false).notNull(),
    defaultValue: jsonb("default_value"),
    showInChatPolicy: varchar("show_in_chat_policy", { length: 20 })
      .default("auto")
      .notNull(),
    allowNewOptions: boolean("allow_new_options").default(true).notNull(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("uq_channel_property_key").on(table.channelId, table.key),
    index("idx_channel_property_defs_channel_order").on(
      table.channelId,
      table.order,
    ),
  ],
);

export type ChannelPropertyDefinition =
  typeof channelPropertyDefinitions.$inferSelect;
export type NewChannelPropertyDefinition =
  typeof channelPropertyDefinitions.$inferInsert;
```

- [ ] **Step 2: Create `message-properties.ts` schema**

```typescript
import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  varchar,
  doublePrecision,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { messages } from "./messages.js";
import { channelPropertyDefinitions } from "./channel-property-definitions.js";
import { users } from "./users.js";

export const messageProperties = pgTable(
  "im_message_properties",
  {
    id: uuid("id").primaryKey().defaultRandom().notNull(),
    messageId: uuid("message_id")
      .references(() => messages.id, { onDelete: "cascade" })
      .notNull(),
    propertyDefinitionId: uuid("property_definition_id")
      .references(() => channelPropertyDefinitions.id, { onDelete: "cascade" })
      .notNull(),
    textValue: text("text_value"),
    numberValue: doublePrecision("number_value"),
    booleanValue: boolean("boolean_value"),
    dateValue: timestamp("date_value"),
    jsonValue: jsonb("json_value"),
    fileKey: varchar("file_key", { length: 500 }),
    fileMetadata: jsonb("file_metadata"),
    order: integer("order").default(0).notNull(),
    createdBy: uuid("created_by").references(() => users.id),
    updatedBy: uuid("updated_by").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("uq_message_property").on(
      table.messageId,
      table.propertyDefinitionId,
    ),
    index("idx_message_props_message").on(table.messageId),
    index("idx_message_props_def_text").on(
      table.propertyDefinitionId,
      table.textValue,
    ),
    index("idx_message_props_def_number").on(
      table.propertyDefinitionId,
      table.numberValue,
    ),
    index("idx_message_props_def_date").on(
      table.propertyDefinitionId,
      table.dateValue,
    ),
    index("idx_message_props_def_bool").on(
      table.propertyDefinitionId,
      table.booleanValue,
    ),
  ],
);

export type MessageProperty = typeof messageProperties.$inferSelect;
export type NewMessageProperty = typeof messageProperties.$inferInsert;
```

Note: GIN index on `jsonValue` must be added in the raw migration SQL since Drizzle doesn't support GIN indexes natively.

- [ ] **Step 3: Create `audit-logs.ts`, `channel-views.ts`, `channel-tabs.ts` schemas**

Follow the same pattern as above. See spec for exact column definitions.

- [ ] **Step 4: Add `propertySettings` to channels schema**

In `apps/server/libs/database/src/schemas/im/channels.ts`, add:

```typescript
propertySettings: jsonb('property_settings').$type<{
  allowNonAdminCreateKey?: boolean;
  propertyDisplayOrder?: 'schema' | 'chronological';
}>(),
```

- [ ] **Step 5: Export all new schemas from index**

In `apps/server/libs/database/src/schemas/im/index.ts`, add:

```typescript
export * from "./channel-property-definitions.js";
export * from "./message-properties.js";
export * from "./audit-logs.js";
export * from "./channel-views.js";
export * from "./channel-tabs.js";
```

- [ ] **Step 6: Generate and apply migration**

```bash
pnpm db:generate
```

Then edit the generated migration file to add the GIN index:

```sql
CREATE INDEX idx_message_props_json_gin ON im_message_properties USING GIN (json_value);
```

```bash
pnpm db:migrate
```

- [ ] **Step 7: Verify build**

```bash
pnpm build:server
```

- [ ] **Step 8: Commit**

```bash
git add apps/server/libs/database/
git commit -m "feat(db): add message properties, views, tabs, and audit log schemas"
```

---

### Task 1: Shared Types & WebSocket Event Constants

**Goal:** Define shared TypeScript types and WebSocket event names for the property system.

**Files:**

- Create: `apps/server/libs/shared/src/types/property.types.ts`
- Create: `apps/server/libs/shared/src/events/domains/property.events.ts`
- Modify: `apps/server/libs/shared/src/events/event-names.ts`
- Modify: `apps/server/libs/shared/src/events/index.ts`
- Modify: `apps/server/libs/shared/src/types/index.ts`

**Acceptance Criteria:**

- [ ] `PropertyValueType` union type covering all 16 types
- [ ] `PropertyDefinitionResponse`, `MessagePropertyResponse` response types
- [ ] WS event names: `PROPERTY.DEFINITION_CREATED/UPDATED/DELETED`, `PROPERTY.MESSAGE_CHANGED`, `VIEW.*`, `TAB.*`
- [ ] Event payload types for all new events
- [ ] `pnpm build:server` succeeds

**Verify:** `pnpm build:server` → no errors

**Steps:**

- [ ] **Step 1: Create shared property types**

In `apps/server/libs/shared/src/types/property.types.ts`:

```typescript
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

export interface PropertyDefinitionResponse {
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
  showInChatPolicy: "auto" | "show" | "hide";
  allowNewOptions: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MessagePropertyValue {
  definitionId: string;
  key: string;
  valueType: PropertyValueType;
  value: unknown;
}

export interface MessagePropertiesMap {
  [key: string]: unknown;
}

export interface ViewResponse {
  id: string;
  channelId: string;
  name: string;
  type: "table" | "board" | "calendar";
  config: ViewConfig;
  order: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ViewConfig {
  filters: ViewFilter[];
  sorts: ViewSort[];
  groupBy?: string;
  visiblePropertiesMode: "whitelist" | "blacklist";
  visibleProperties: string[];
  columnWidths?: Record<string, number>;
  datePropertyKey?: string;
  defaultCalendarView?: "month" | "week" | "day";
  showRecurring?: boolean;
}

export interface ViewFilter {
  propertyKey: string;
  operator:
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
    | "in";
  value: unknown;
}

export interface ViewSort {
  propertyKey: string;
  direction: "asc" | "desc";
}

export interface TabResponse {
  id: string;
  channelId: string;
  name: string;
  type: "messages" | "files" | "table_view" | "board_view" | "calendar_view";
  viewId: string | null;
  isBuiltin: boolean;
  order: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 2: Add WS event constants**

In `apps/server/libs/shared/src/events/event-names.ts`, add to `WS_EVENTS`:

```typescript
PROPERTY: {
  DEFINITION_CREATED: 'property_definition_created',
  DEFINITION_UPDATED: 'property_definition_updated',
  DEFINITION_DELETED: 'property_definition_deleted',
  MESSAGE_CHANGED: 'message_property_changed',
},

VIEW: {
  CREATED: 'view_created',
  UPDATED: 'view_updated',
  DELETED: 'view_deleted',
},

TAB: {
  CREATED: 'tab_created',
  UPDATED: 'tab_updated',
  DELETED: 'tab_deleted',
},
```

- [ ] **Step 3: Create event payload types**

In `apps/server/libs/shared/src/events/domains/property.events.ts`:

```typescript
import type {
  PropertyDefinitionResponse,
  TabResponse,
  ViewResponse,
} from "../../types/property.types.js";

export interface PropertyDefinitionCreatedEvent {
  channelId: string;
  definition: PropertyDefinitionResponse;
}

export interface PropertyDefinitionUpdatedEvent {
  channelId: string;
  definitionId: string;
  changes: Record<string, { old: unknown; new: unknown }>;
}

export interface PropertyDefinitionDeletedEvent {
  channelId: string;
  definitionId: string;
}

export interface MessagePropertyChangedEvent {
  channelId: string;
  messageId: string;
  properties: {
    set?: Record<string, unknown>;
    removed?: string[];
  };
  performedBy: string | null;
}

export interface ViewCreatedEvent {
  channelId: string;
  view: ViewResponse;
}
export interface ViewUpdatedEvent {
  channelId: string;
  viewId: string;
  changes: Record<string, unknown>;
}
export interface ViewDeletedEvent {
  channelId: string;
  viewId: string;
}
export interface TabCreatedEvent {
  channelId: string;
  tab: TabResponse;
}
export interface TabUpdatedEvent {
  channelId: string;
  tabId: string;
  changes: Record<string, unknown>;
}
export interface TabDeletedEvent {
  channelId: string;
  tabId: string;
}
```

- [ ] **Step 4: Export from index files and commit**

```bash
git add apps/server/libs/shared/
git commit -m "feat(shared): add property system types and WebSocket event constants"
```

---

### Task 2: Property Definitions Module (Backend)

**Goal:** CRUD service + controller for channel property definitions with schema-on-write, native property seeding, and WebSocket broadcasts.

**Files:**

- Create: `apps/server/apps/gateway/src/im/properties/properties.module.ts`
- Create: `apps/server/apps/gateway/src/im/properties/property-definitions.service.ts`
- Create: `apps/server/apps/gateway/src/im/properties/property-definitions.service.spec.ts`
- Create: `apps/server/apps/gateway/src/im/properties/property-definitions.controller.ts`
- Create: `apps/server/apps/gateway/src/im/properties/dto/create-property-definition.dto.ts`
- Create: `apps/server/apps/gateway/src/im/properties/dto/update-property-definition.dto.ts`
- Modify: `apps/server/apps/gateway/src/im/im.module.ts`

**Acceptance Criteria:**

- [ ] `GET /v1/im/channels/:channelId/property-definitions` returns all definitions ordered by `order`
- [ ] `POST` creates definition; rejects duplicate keys; rejects `_` prefix for non-native
- [ ] `PATCH` updates definition; rejects type change; rejects native deletion
- [ ] `DELETE` removes definition + cascades; rejects native
- [ ] `PATCH .../order` batch-reorders definitions
- [ ] `seedNativeProperties(channelId)` inserts `_tags`, `_people`, `_tasks`, `_messages` on channel creation
- [ ] WebSocket broadcasts `property_definition_created/updated/deleted` to channel room
- [ ] Tests cover: CRUD, duplicate key rejection, native protection, schema-on-write auto-create
- [ ] Permission checks: channel membership + write access required

**Verify:** `pnpm jest -- --testPathPattern=property-definitions.service.spec` → all pass

**Steps:**

- [ ] **Step 1: Write tests** — Create `property-definitions.service.spec.ts` following the `SectionsService` test pattern: mock db with `jest.unstable_mockModule`, test `create()`, `findAll()`, `update()`, `delete()`, `reorder()`, `seedNativeProperties()`. Test error cases: duplicate key, type change attempt, native deletion.

- [ ] **Step 2: Implement `PropertyDefinitionsService`** — Inject `DATABASE_CONNECTION`. Methods: `findAll(channelId)`, `create(dto, channelId, userId)`, `update(id, dto)`, `delete(id)`, `reorder(channelId, ids[])`, `seedNativeProperties(channelId)`, `findOrCreate(channelId, key, valueType, userId)` for schema-on-write.

- [ ] **Step 3: Create DTOs** — `CreatePropertyDefinitionDto` with validation: `key` (MaxLength 100, Matches /^[a-zA-Z][a-zA-Z0-9_]\*$/), `valueType` (IsEnum), `description?`, `config?`, `aiAutoFill?`, `showInChatPolicy?`, `allowNewOptions?`. `UpdatePropertyDefinitionDto` is partial (no `key` or `valueType` changes).

- [ ] **Step 4: Create controller** — Route: `@Controller({ path: 'im/channels/:channelId/property-definitions', version: '1' })`. Use `@UseGuards(AuthGuard, WorkspaceGuard)`. All endpoints require channel membership check.

- [ ] **Step 5: Create module and register in im.module.ts**

```typescript
@Module({
  imports: [DatabaseModule],
  controllers: [PropertyDefinitionsController],
  providers: [PropertyDefinitionsService],
  exports: [PropertyDefinitionsService],
})
export class PropertiesModule {}
```

Add `PropertiesModule` to `ImModule` imports.

- [ ] **Step 6: Add WebSocket broadcast** — After create/update/delete, emit events via the WebSocket gateway's `server.to(channelId).emit()`.

- [ ] **Step 7: Run tests and commit**

```bash
pnpm jest -- --testPathPattern=property-definitions.service.spec
git commit -m "feat(properties): add property definitions CRUD service and controller"
```

---

### Task 3: Message Properties Module (Backend)

**Goal:** Service + controller for setting/getting/removing property values on messages with type validation.

**Files:**

- Create: `apps/server/apps/gateway/src/im/properties/message-properties.service.ts`
- Create: `apps/server/apps/gateway/src/im/properties/message-properties.service.spec.ts`
- Create: `apps/server/apps/gateway/src/im/properties/message-properties.controller.ts`
- Create: `apps/server/apps/gateway/src/im/properties/dto/set-property-value.dto.ts`
- Create: `apps/server/apps/gateway/src/im/properties/dto/batch-set-properties.dto.ts`

**Acceptance Criteria:**

- [ ] `GET /v1/im/messages/:messageId/properties` returns all properties as key-value map
- [ ] `PUT .../properties/:definitionId` sets a single property with type validation
- [ ] `DELETE .../properties/:definitionId` removes a property
- [ ] `PATCH .../properties` batch-sets multiple properties (used by AI auto-fill)
- [ ] Type validation: value matches definition's valueType (number value for number type, etc.)
- [ ] Value stored in correct column (textValue for text/url/single_select, numberValue for number, etc.)
- [ ] WebSocket broadcasts `message_property_changed` event
- [ ] Audit log entry created for every set/update/remove
- [ ] Permission check: message must be in a public/private channel, user must have write access

**Verify:** `pnpm jest -- --testPathPattern=message-properties.service.spec` → all pass

**Steps:**

- [ ] **Step 1: Write tests** — Test `getProperties(messageId)`, `setProperty(messageId, definitionId, value, userId)`, `removeProperty(messageId, definitionId, userId)`, `batchSet(messageId, properties[], userId)`. Test type validation failures, non-existent definitions, channel type restrictions.

- [ ] **Step 2: Implement `MessagePropertiesService`** — Key method `setProperty()`:

```typescript
async setProperty(messageId: string, definitionId: string, value: unknown, userId: string) {
  const definition = await this.getDefinition(definitionId);
  const validated = this.validateAndMapValue(definition.valueType, value);

  const [existing] = await this.db
    .select().from(schema.messageProperties)
    .where(and(
      eq(schema.messageProperties.messageId, messageId),
      eq(schema.messageProperties.propertyDefinitionId, definitionId),
    )).limit(1);

  if (existing) {
    await this.db.update(schema.messageProperties)
      .set({ ...validated, updatedBy: userId, updatedAt: new Date() })
      .where(eq(schema.messageProperties.id, existing.id));
  } else {
    await this.db.insert(schema.messageProperties).values({
      messageId, propertyDefinitionId: definitionId,
      ...validated, createdBy: userId, order: await this.getNextOrder(messageId),
    });
  }

  await this.auditService.log({ /* ... */ });
}

private validateAndMapValue(valueType: PropertyValueType, value: unknown): Partial<NewMessageProperty> {
  switch (valueType) {
    case 'text': case 'url': case 'single_select':
      if (typeof value !== 'string') throw new BadRequestException('Expected string value');
      return { textValue: value };
    case 'number':
      if (typeof value !== 'number') throw new BadRequestException('Expected number value');
      return { numberValue: value };
    case 'boolean':
      if (typeof value !== 'boolean') throw new BadRequestException('Expected boolean value');
      return { booleanValue: value };
    case 'date': case 'timestamp':
      return { dateValue: new Date(value as string) };
    case 'multi_select': case 'person': case 'message_ref':
    case 'date_range': case 'timestamp_range': case 'recurring': case 'tags':
      return { jsonValue: value };
    case 'file': case 'image':
      const fv = value as { fileKey: string; metadata: Record<string, unknown> };
      return { fileKey: fv.fileKey, fileMetadata: fv.metadata };
    default:
      throw new BadRequestException(`Unsupported value type: ${valueType}`);
  }
}
```

- [ ] **Step 3: Create DTOs, controller, and register** — Controller route: `@Controller({ path: 'im/messages/:messageId/properties', version: '1' })`.

- [ ] **Step 4: Run tests and commit**

```bash
pnpm jest -- --testPathPattern=message-properties.service.spec
git commit -m "feat(properties): add message property values CRUD with type validation"
```

---

### Task 4: Audit Log Module (Backend)

**Goal:** Service for recording all property/channel/message changes and controller for querying audit logs.

**Files:**

- Create: `apps/server/apps/gateway/src/im/audit/audit.module.ts`
- Create: `apps/server/apps/gateway/src/im/audit/audit.service.ts`
- Create: `apps/server/apps/gateway/src/im/audit/audit.controller.ts`
- Create: `apps/server/apps/gateway/src/im/audit/dto/query-audit-logs.dto.ts`

**Acceptance Criteria:**

- [ ] `AuditService.log()` inserts a row into `audit_logs` with entityType, action, changes JSONB, and optional metadata
- [ ] `GET /v1/im/channels/:channelId/audit-logs` returns paginated logs filterable by entityType and action
- [ ] AI operations include `metadata: { source: "ai_auto_fill", model: "...", round: N }`
- [ ] Audit entries for property changes appear as system-like messages in thread view (frontend will query this)

**Verify:** `pnpm build:server` → no errors

**Steps:**

- [ ] **Step 1: Create `AuditService`**

```typescript
@Injectable()
export class AuditService {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async log(params: {
    channelId?: string;
    entityType: "channel" | "message";
    entityId: string;
    action: string;
    changes: Record<string, { old: unknown; new: unknown }>;
    performedBy?: string;
    metadata?: Record<string, unknown>;
  }) {
    await this.db.insert(schema.auditLogs).values({
      channelId: params.channelId,
      entityType: params.entityType,
      entityId: params.entityId,
      action: params.action,
      changes: params.changes,
      performedBy: params.performedBy,
      metadata: params.metadata,
    });
  }

  async findByChannel(
    channelId: string,
    opts: {
      limit: number;
      cursor?: string;
      entityType?: string;
      action?: string;
    },
  ) {
    // cursor-based pagination query
  }
}
```

- [ ] **Step 2: Create controller and module, register in im.module.ts, commit**

```bash
git commit -m "feat(audit): add audit log service and query endpoint"
```

---

### Task 5: Extend Existing Message API with Properties

**Goal:** Include properties in message list responses and accept properties in message creation.

**Files:**

- Modify: `apps/server/apps/gateway/src/im/messages/messages.service.ts`
- Modify: `apps/server/apps/gateway/src/im/messages/messages.controller.ts`
- Modify: `apps/server/apps/gateway/src/im/messages/dto/create-message.dto.ts`
- Modify: `apps/server/libs/shared/src/types/message.types.ts`

**Acceptance Criteria:**

- [ ] `GET /v1/im/channels/:channelId/messages` response includes `properties` map per message (only `showInChatPolicy !== 'hide'`)
- [ ] `POST /v1/im/channels/:channelId/messages` accepts optional `properties` field
- [ ] Properties loaded via two-pass query: fetch messages first, batch-load properties, merge
- [ ] Schema-on-write: unknown keys in `properties` auto-create definitions (if `allowNonAdminCreateKey` permits)
- [ ] `MessageResponse` type includes `properties?: Record<string, unknown>`

**Verify:** `pnpm build:server` → no errors; manual test with REST client

**Steps:**

- [ ] **Step 1: Add `properties` to `CreateMessageDto`**

```typescript
@IsOptional()
@IsObject()
properties?: Record<string, unknown>;
```

- [ ] **Step 2: Extend message service** — In `getChannelMessages()`, after fetching messages, batch-load their properties:

```typescript
const messageIds = messages.map((m) => m.id);
const properties = await this.messagePropertiesService.batchGetByMessageIds(
  messageIds,
  { excludeHidden: true },
);
return messages.map((m) => ({ ...m, properties: properties[m.id] || {} }));
```

- [ ] **Step 3: Handle properties in message creation** — After message is persisted, if `dto.properties` is set, call `messagePropertiesService.batchSet()`.

- [ ] **Step 4: Update MessageResponse type, commit**

```bash
git commit -m "feat(messages): include properties in message responses and creation"
```

---

### Task 6: Channel Views Module (Backend)

**Goal:** CRUD service + controller for channel views with grouped pagination data query.

**Files:**

- Create: `apps/server/apps/gateway/src/im/views/views.module.ts`
- Create: `apps/server/apps/gateway/src/im/views/views.service.ts`
- Create: `apps/server/apps/gateway/src/im/views/views.service.spec.ts`
- Create: `apps/server/apps/gateway/src/im/views/views.controller.ts`
- Create: `apps/server/apps/gateway/src/im/views/dto/create-view.dto.ts`
- Create: `apps/server/apps/gateway/src/im/views/dto/update-view.dto.ts`
- Create: `apps/server/apps/gateway/src/im/views/dto/query-view-messages.dto.ts`

**Acceptance Criteria:**

- [ ] CRUD for views with config validation (filters ≤ 10, sorts ≤ 3)
- [ ] `GET .../views/:viewId/messages` returns messages with properties, filtered/sorted/grouped per view config
- [ ] Grouped response: each group has independent cursor + total
- [ ] LEFT JOINs on `message_properties` for each filter/sort property
- [ ] WebSocket broadcasts `view_created/updated/deleted`
- [ ] View limit: 20 per channel

**Verify:** `pnpm jest -- --testPathPattern=views.service.spec` → all pass

**Steps:**

- [ ] **Step 1: Write tests** — Test view CRUD, config validation, grouped query with pagination.

- [ ] **Step 2: Implement `ViewsService`** — Key method `queryMessages()`:

```typescript
async queryMessages(viewId: string, params: { group?: string; cursor?: string; limit?: number }) {
  const view = await this.findById(viewId);
  const { filters, sorts, groupBy } = view.config;

  let query = this.db.select().from(schema.messages)
    .where(and(
      eq(schema.messages.channelId, view.channelId),
      eq(schema.messages.isDeleted, false),
      isNull(schema.messages.parentId), // root messages only
    ));

  // Add LEFT JOINs and WHERE clauses for each filter
  for (const filter of filters) {
    // Build dynamic filter based on operator and property type
  }

  if (groupBy) {
    // Return grouped response with per-group pagination
  }

  // Apply sorts, cursor pagination
  return { messages, cursor, total };
}
```

- [ ] **Step 3: Create DTOs, controller, module, register, commit**

```bash
git commit -m "feat(views): add channel views CRUD with filtered/grouped message queries"
```

---

### Task 7: Channel Tabs Module (Backend)

**Goal:** CRUD service + controller for channel tabs with built-in tab seeding.

**Files:**

- Create: `apps/server/apps/gateway/src/im/views/tabs.service.ts`
- Create: `apps/server/apps/gateway/src/im/views/tabs.controller.ts`
- Create: `apps/server/apps/gateway/src/im/views/dto/create-tab.dto.ts`

**Acceptance Criteria:**

- [ ] `GET /v1/im/channels/:channelId/tabs` returns all tabs ordered by `order`
- [ ] CRUD with protection: built-in tabs (Messages, Files) cannot be deleted
- [ ] `seedBuiltinTabs(channelId)` creates Messages + Files tabs on channel creation
- [ ] Creating a view-type tab requires a valid `viewId`
- [ ] WebSocket broadcasts `tab_created/updated/deleted`

**Verify:** `pnpm build:server` → no errors

**Steps:**

- [ ] **Step 1: Implement `TabsService`** — CRUD methods + `seedBuiltinTabs()`.
- [ ] **Step 2: Create controller** — Route: `im/channels/:channelId/tabs`.
- [ ] **Step 3: Hook seeding into channel creation** — Call `seedBuiltinTabs()` and `seedNativeProperties()` in the channel creation flow.
- [ ] **Step 4: Commit**

```bash
git commit -m "feat(tabs): add channel tabs CRUD with built-in tab seeding"
```

---

### Task 8: AI Auto-Fill Service (Backend)

**Goal:** Service that uses AI to auto-generate property values for messages using function_call pattern.

**Files:**

- Create: `apps/server/apps/gateway/src/im/properties/ai-auto-fill.service.ts`
- Create: `apps/server/apps/gateway/src/im/properties/ai-auto-fill.service.spec.ts`
- Modify: `apps/server/apps/gateway/src/im/properties/message-properties.controller.ts` (add auto-fill endpoint)

**Acceptance Criteria:**

- [ ] `POST /v1/im/messages/:messageId/properties/auto-fill` triggers AI fill
- [ ] Builds XML prompt with channel info, message content, reactions, thread replies, current properties, and channel schema
- [ ] Generates function_call tool schema dynamically from channel property definitions (only `aiAutoFill=true` fields)
- [ ] Validates AI response: type matching, option existence, required fields
- [ ] Retries on validation failure up to 3 rounds
- [ ] Records results in audit_log with `source: "ai_auto_fill"`
- [ ] Supports `fields` parameter for selective generation
- [ ] Supports `preserveExisting: true` for manual triggers
- [ ] Auto-triggers on message create/edit (via event listener)

**Verify:** `pnpm jest -- --testPathPattern=ai-auto-fill.service.spec` → all pass

**Steps:**

- [ ] **Step 1: Write tests** — Mock AI client. Test: prompt building, response parsing, validation, retry logic, selective fields, audit logging.

- [ ] **Step 2: Implement `AiAutoFillService`**

```typescript
@Injectable()
export class AiAutoFillService {
  constructor(
    private readonly aiClient: AiClientService,
    private readonly propertyDefsService: PropertyDefinitionsService,
    private readonly messagePropsService: MessagePropertiesService,
    private readonly auditService: AuditService,
    @Inject(DATABASE_CONNECTION) private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async autoFill(messageId: string, opts?: { fields?: string[]; preserveExisting?: boolean }) {
    const message = await this.loadMessageWithContext(messageId);
    const definitions = await this.propertyDefsService.findAll(message.channelId);
    const currentProps = await this.messagePropsService.getProperties(messageId);

    const fillableFields = definitions.filter(d =>
      d.aiAutoFill && (!opts?.fields || opts.fields.includes(d.key))
    );

    const prompt = this.buildXmlPrompt(message, currentProps, definitions, fillableFields, opts);
    const toolSchema = this.buildToolSchema(fillableFields);

    let result: Record<string, { value?: unknown; unchanged?: boolean }> | null = null;
    for (let round = 1; round <= 3; round++) {
      const aiResponse = await this.aiClient.generateWithTools(prompt, [toolSchema]);
      const validation = this.validateResponse(aiResponse, fillableFields);
      if (validation.valid) {
        result = aiResponse;
        break;
      }
      prompt += `\n<error round="${round}">${validation.errors.join('; ')}</error>`;
    }

    if (!result) {
      await this.auditService.log({ /* failure log */ });
      return;
    }

    // Apply valid results
    const propertiesToSet = [];
    for (const [key, entry] of Object.entries(result)) {
      if (entry.unchanged) continue;
      propertiesToSet.push({ key, value: entry.value });
    }

    if (propertiesToSet.length > 0) {
      await this.messagePropsService.batchSet(messageId, propertiesToSet, null);
      await this.auditService.log({
        entityType: 'message', entityId: messageId, action: 'property_set',
        changes: /* build changes map */,
        metadata: { source: 'ai_auto_fill', model: this.aiClient.modelId, round },
      });
    }
  }

  private buildXmlPrompt(...): string {
    // Build XML as specified in the spec
  }
}
```

- [ ] **Step 3: Add auto-fill endpoint to controller, register service, commit**

```bash
git commit -m "feat(ai): add AI auto-fill service for message properties"
```

---

### Task 9: Frontend Types & API Client

**Goal:** Define frontend TypeScript types and API client functions for the property system.

**Files:**

- Create: `apps/client/src/types/properties.ts`
- Create: `apps/client/src/services/api/properties.ts`
- Create: `apps/client/src/services/api/views.ts`

**Acceptance Criteria:**

- [ ] All 16 property value types have TypeScript type definitions
- [ ] API client covers: property definitions CRUD, message property CRUD, batch set, auto-fill, views CRUD, view messages query, tabs CRUD, audit logs
- [ ] Types match backend response types exactly
- [ ] API functions follow existing `messagesApi` pattern (object with async methods)

**Verify:** `pnpm build:client` → no errors

**Steps:**

- [ ] **Step 1: Create `types/properties.ts`**

```typescript
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

export interface PropertyDefinition {
  id: string;
  channelId: string;
  key: string;
  description: string | null;
  valueType: PropertyValueType;
  isNative: boolean;
  config: SelectConfig | PersonConfig | NumberConfig | Record<string, unknown>;
  order: number;
  aiAutoFill: boolean;
  aiAutoFillPrompt: string | null;
  isRequired: boolean;
  defaultValue: unknown;
  showInChatPolicy: "auto" | "show" | "hide";
  allowNewOptions: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SelectConfig {
  options: { value: string; color?: string }[];
}

export interface PersonConfig {
  multiple: boolean;
}

export interface NumberConfig {
  format: "number" | "percent" | "currency";
}

export interface ChannelView {
  id: string;
  channelId: string;
  name: string;
  type: "table" | "board" | "calendar";
  config: ViewConfig;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface ViewConfig {
  filters: ViewFilter[];
  sorts: ViewSort[];
  groupBy?: string;
  visiblePropertiesMode: "whitelist" | "blacklist";
  visibleProperties: string[];
  columnWidths?: Record<string, number>;
  datePropertyKey?: string;
  defaultCalendarView?: "month" | "week" | "day";
  showRecurring?: boolean;
}

export interface ViewFilter {
  propertyKey: string;
  operator: string;
  value: unknown;
}

export interface ViewSort {
  propertyKey: string;
  direction: "asc" | "desc";
}

export interface ChannelTab {
  id: string;
  channelId: string;
  name: string;
  type: "messages" | "files" | "table_view" | "board_view" | "calendar_view";
  viewId: string | null;
  isBuiltin: boolean;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface ViewMessagesGroup {
  value: string;
  total: number;
  cursor: string | null;
  messages: MessageWithProperties[];
}

export interface MessageWithProperties {
  id: string;
  content: string;
  sender: { id: string; displayName: string; avatarUrl?: string };
  createdAt: string;
  properties: Record<string, unknown>;
}
```

- [ ] **Step 2: Create API clients** — Follow `messagesApi` pattern.

- [ ] **Step 3: Add `properties` to existing `Message` type**

In `apps/client/src/types/im.ts`, add to `Message` interface:

```typescript
properties?: Record<string, unknown>;
```

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(client): add property system types and API client"
```

---

### Task 10: React Query Hooks & WebSocket Handlers

**Goal:** Create hooks for property definitions, message properties, views, and tabs with WebSocket cache invalidation.

**Files:**

- Create: `apps/client/src/hooks/usePropertyDefinitions.ts`
- Create: `apps/client/src/hooks/useMessageProperties.ts`
- Create: `apps/client/src/hooks/useChannelViews.ts`
- Create: `apps/client/src/hooks/useChannelTabs.ts`
- Modify: `apps/client/src/services/websocket/index.ts`
- Modify: `apps/client/src/hooks/useWebSocketEvents.ts`

**Acceptance Criteria:**

- [ ] `usePropertyDefinitions(channelId)` fetches and caches definitions; invalidates on WS `property_definition_*`
- [ ] `useChannelTabs(channelId)` fetches tabs; invalidates on WS `tab_*`
- [ ] `useViewMessages(viewId, config)` fetches paginated view data; invalidates on WS `message_property_changed`
- [ ] Mutation hooks: `useSetProperty`, `useRemoveProperty`, `useBatchSetProperties`, `useAutoFill`
- [ ] WebSocket service has typed listener methods: `onPropertyDefinitionCreated()`, `onMessagePropertyChanged()`, etc.
- [ ] Optimistic updates for property set/remove operations

**Verify:** `pnpm build:client` → no errors

**Steps:**

- [ ] **Step 1: Add WebSocket listeners to websocket service**

In `apps/client/src/services/websocket/index.ts`:

```typescript
onPropertyDefinitionCreated(callback: (event: PropertyDefinitionCreatedEvent) => void) {
  this.on(WS_EVENTS.PROPERTY.DEFINITION_CREATED, callback);
}
onPropertyDefinitionUpdated(callback: (event: PropertyDefinitionUpdatedEvent) => void) {
  this.on(WS_EVENTS.PROPERTY.DEFINITION_UPDATED, callback);
}
onPropertyDefinitionDeleted(callback: (event: PropertyDefinitionDeletedEvent) => void) {
  this.on(WS_EVENTS.PROPERTY.DEFINITION_DELETED, callback);
}
onMessagePropertyChanged(callback: (event: MessagePropertyChangedEvent) => void) {
  this.on(WS_EVENTS.PROPERTY.MESSAGE_CHANGED, callback);
}
// Same for VIEW.* and TAB.*
```

- [ ] **Step 2: Create hooks**

```typescript
// usePropertyDefinitions.ts
export function usePropertyDefinitions(channelId: string | undefined) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["channel", channelId, "propertyDefinitions"],
    queryFn: () => propertiesApi.getDefinitions(channelId!),
    enabled: !!channelId,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (!channelId) return;
    const handleCreated = (event: PropertyDefinitionCreatedEvent) => {
      if (event.channelId !== channelId) return;
      queryClient.invalidateQueries({
        queryKey: ["channel", channelId, "propertyDefinitions"],
      });
    };
    wsService.onPropertyDefinitionCreated(handleCreated);
    // ... similar for updated/deleted
    return () => {
      /* cleanup */
    };
  }, [channelId, queryClient]);

  return query;
}
```

- [ ] **Step 3: Create mutation hooks**

```typescript
export function useSetProperty(messageId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      definitionId,
      value,
    }: {
      definitionId: string;
      value: unknown;
    }) => propertiesApi.setProperty(messageId, definitionId, value),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["message", messageId, "properties"],
      });
    },
  });
}
```

- [ ] **Step 4: Add WS event handling to `useWebSocketEvents.ts`, commit**

```bash
git commit -m "feat(client): add property system hooks and WebSocket handlers"
```

---

### Task 11: Property Editor Components

**Goal:** Create type-specific editor components for all 16 property value types.

**Files:**

- Create: `apps/client/src/components/channel/properties/PropertyEditor.tsx`
- Create: `apps/client/src/components/channel/properties/editors/TextEditor.tsx`
- Create: `apps/client/src/components/channel/properties/editors/NumberEditor.tsx`
- Create: `apps/client/src/components/channel/properties/editors/BooleanEditor.tsx`
- Create: `apps/client/src/components/channel/properties/editors/SelectEditor.tsx`
- Create: `apps/client/src/components/channel/properties/editors/PersonPicker.tsx`
- Create: `apps/client/src/components/channel/properties/editors/DatePicker.tsx`
- Create: `apps/client/src/components/channel/properties/editors/UrlEditor.tsx`
- Create: `apps/client/src/components/channel/properties/editors/MessageRefPicker.tsx`
- Create: `apps/client/src/components/channel/properties/editors/FileUploader.tsx`
- Create: `apps/client/src/components/channel/properties/editors/RecurringEditor.tsx`
- Create: `apps/client/src/components/channel/properties/editors/index.ts`

**Acceptance Criteria:**

- [ ] `PropertyEditor` dispatches to correct editor based on `valueType`
- [ ] Each editor handles its specific UI: text input, number input, checkbox, select dropdown, date picker, etc.
- [ ] `SelectEditor` supports adding new options (if `allowNewOptions` is true) with color picker
- [ ] `PersonPicker` searches channel members
- [ ] `DatePicker` supports date-only and date+time modes
- [ ] `RecurringEditor` lets user configure frequency, interval, day-of-week/month
- [ ] All editors call `onChange(value)` prop on change
- [ ] Uses Radix UI primitives (Popover, Select, etc.) consistent with existing codebase

**Verify:** `pnpm build:client` → no errors

**Steps:**

- [ ] **Step 1: Create `PropertyEditor` dispatcher**

```tsx
interface PropertyEditorProps {
  definition: PropertyDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
}

export function PropertyEditor({
  definition,
  value,
  onChange,
  disabled,
}: PropertyEditorProps) {
  switch (definition.valueType) {
    case "text":
      return (
        <TextEditor
          value={value as string}
          onChange={onChange}
          disabled={disabled}
        />
      );
    case "number":
      return (
        <NumberEditor
          value={value as number}
          onChange={onChange}
          disabled={disabled}
        />
      );
    case "boolean":
      return (
        <BooleanEditor
          value={value as boolean}
          onChange={onChange}
          disabled={disabled}
        />
      );
    case "single_select":
    case "multi_select":
    case "tags":
      return (
        <SelectEditor
          definition={definition}
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      );
    case "person":
      return (
        <PersonPicker
          definition={definition}
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      );
    case "date":
    case "timestamp":
    case "date_range":
    case "timestamp_range":
      return (
        <DatePicker
          definition={definition}
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      );
    case "url":
      return (
        <UrlEditor
          value={value as string}
          onChange={onChange}
          disabled={disabled}
        />
      );
    case "message_ref":
      return (
        <MessageRefPicker
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      );
    case "file":
    case "image":
      return (
        <FileUploader
          definition={definition}
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      );
    case "recurring":
      return (
        <RecurringEditor
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      );
  }
}
```

- [ ] **Step 2: Implement each editor** — Start with simple ones (Text, Number, Boolean, Url), then complex (Select, Person, Date, File, Recurring, MessageRef).

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(client): add property editor components for all 16 value types"
```

---

### Task 12: Chat View Property Display

**Goal:** Display property chips on messages in the chat view and add property button to hover toolbar.

**Files:**

- Create: `apps/client/src/components/channel/properties/MessageProperties.tsx`
- Create: `apps/client/src/components/channel/properties/PropertyTag.tsx`
- Create: `apps/client/src/components/channel/properties/PropertyValue.tsx`
- Create: `apps/client/src/components/channel/MessageTitle.tsx`
- Modify: `apps/client/src/components/channel/MessageItem.tsx`
- Modify: `apps/client/src/components/channel/MessageHoverToolbar.tsx`

**Acceptance Criteria:**

- [ ] `MessageTitle` renders title prominently above message content (if set)
- [ ] `MessageProperties` renders property chips (tags, people, values) below message content
- [ ] Chips clickable → inline edit via PropertyEditor popover
- [ ] `[...]` button at end when properties exist; `[+]` after reactions when no properties
- [ ] `showInChatPolicy` respected: `show` always, `auto` when value exists, `hide` never
- [ ] Hover toolbar has property button (📎 icon)
- [ ] Property display order follows channel `propertyDisplayOrder` setting

**Verify:** `pnpm build:client` → no errors

**Steps:**

- [ ] **Step 1: Create `MessageProperties`**

```tsx
interface MessagePropertiesProps {
  message: Message;
  channelId: string;
  definitions: PropertyDefinition[];
  canEdit: boolean;
}

export function MessageProperties({
  message,
  channelId,
  definitions,
  canEdit,
}: MessagePropertiesProps) {
  const properties = message.properties || {};
  const visibleDefs = definitions.filter((d) => {
    if (d.showInChatPolicy === "hide") return false;
    if (d.showInChatPolicy === "show") return true;
    return properties[d.key] != null; // 'auto': show when value exists
  });

  if (visibleDefs.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1 mt-1">
      {visibleDefs.map((def) => (
        <PropertyChip
          key={def.id}
          definition={def}
          value={properties[def.key]}
          canEdit={canEdit}
          messageId={message.id}
        />
      ))}
      {canEdit && <MoreButton messageId={message.id} channelId={channelId} />}
    </div>
  );
}
```

- [ ] **Step 2: Create `PropertyTag` and `PropertyValue` chip components**

- [ ] **Step 3: Create `MessageTitle`** — Renders title above message content, with AI generate button.

- [ ] **Step 4: Integrate into MessageItem** — Add `<MessageTitle>` before content, `<MessageProperties>` after content/before reactions.

- [ ] **Step 5: Add property button to MessageHoverToolbar**

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(client): display property chips on messages in chat view"
```

---

### Task 13: Property Selector & Panel

**Goal:** Sub-menu property picker and Notion-style property panel for message detail view.

**Files:**

- Create: `apps/client/src/components/channel/properties/PropertySelector.tsx`
- Create: `apps/client/src/components/channel/properties/PropertyPanel.tsx`

**Acceptance Criteria:**

- [ ] `PropertySelector` shows searchable list of channel properties with sub-menu editors
- [ ] Supports creating new properties inline (if permitted)
- [ ] `PropertyPanel` shows Notion-style two-column layout (key | value) for message detail
- [ ] Tags shown in flat row with `+` and `×` delete
- [ ] Properties collapse if > 5 rows; expand button shows count
- [ ] For `long_text` messages, properties display before content
- [ ] For messages with no tags/properties, panel hidden; top-right shows add button
- [ ] Thread view shows property change audit entries as system messages

**Verify:** `pnpm build:client` → no errors

**Steps:**

- [ ] **Step 1: Create `PropertySelector`** — Radix Popover with search input, property list with sub-menu (Radix DropdownMenu nested), and "Create new property" option.

- [ ] **Step 2: Create `PropertyPanel`** — Renders in message detail sidebar. Layout: Title → Tags → Content (or Content → Properties for non-long_text) → Properties table → Thread.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(client): add property selector sub-menu and detail panel"
```

---

### Task 14: Channel Tabs UI

**Goal:** Tab bar component showing Messages, Files, and custom view tabs.

**Files:**

- Create: `apps/client/src/components/channel/ChannelTabs.tsx`
- Modify: `apps/client/src/components/channel/ChannelHeader.tsx`

**Acceptance Criteria:**

- [ ] Tab bar renders below channel header, showing all tabs ordered by `order`
- [ ] Active tab highlighted; click switches content
- [ ] Messages and Files tabs are built-in
- [ ] "+" button to create new view tab (opens view creation dialog)
- [ ] Tabs can be renamed, reordered (drag), and deleted (non-builtin)
- [ ] View tabs render their corresponding view component (Table/Board/Calendar)

**Verify:** `pnpm build:client` → no errors

**Steps:**

- [ ] **Step 1: Create `ChannelTabs`** — Uses `useChannelTabs(channelId)` hook. Renders tabs with Radix Tabs or custom implementation.

- [ ] **Step 2: Integrate into ChannelHeader** — Render `ChannelTabs` below channel name/description area.

- [ ] **Step 3: Route tab content** — When a view tab is active, render the corresponding view component instead of MessageList.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(client): add channel tabs UI with view switching"
```

---

### Task 15: Table View

**Goal:** Spreadsheet-like table view with inline editing, filtering, sorting, grouping, and add row.

**Files:**

- Create: `apps/client/src/components/channel/views/TableView.tsx`
- Create: `apps/client/src/components/channel/views/TableHeader.tsx`
- Create: `apps/client/src/components/channel/views/TableRow.tsx`
- Create: `apps/client/src/components/channel/views/TableCell.tsx`
- Create: `apps/client/src/components/channel/views/TableAddRow.tsx`

**Acceptance Criteria:**

- [ ] Renders messages as rows with property columns
- [ ] Title and Content are always-visible columns
- [ ] Property columns determined by `visiblePropertiesMode` + `visibleProperties`
- [ ] Cell click → inline edit via PropertyEditor (except Content for non-sender)
- [ ] Column headers sortable (click to toggle asc/desc)
- [ ] Column headers resizable and reorderable (drag)
- [ ] `[+ New message]` row at bottom creates message with properties
- [ ] Per-group pagination when `groupBy` is set
- [ ] Infinite scroll within each group

**Verify:** `pnpm build:client` → no errors

**Steps:**

- [ ] **Step 1: Create `TableView`** — Uses `useViewMessages(viewId)` hook. Renders table structure with header and rows. Handles grouped vs ungrouped rendering.

- [ ] **Step 2: Create `TableCell`** — Dispatches to PropertyEditor in inline mode. Content cell uses textarea; respects sender-only editing.

- [ ] **Step 3: Create `TableAddRow`** — Form row at bottom that creates a new message with pre-filled properties.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(client): add table view with inline editing and grouped pagination"
```

---

### Task 16: Board View

**Goal:** Kanban-style board view with drag-and-drop between columns.

**Files:**

- Create: `apps/client/src/components/channel/views/BoardView.tsx`
- Create: `apps/client/src/components/channel/views/BoardColumn.tsx`
- Create: `apps/client/src/components/channel/views/BoardCard.tsx`

**Acceptance Criteria:**

- [ ] Groups messages by a single_select property into columns
- [ ] Each column independently scrollable with lazy loading
- [ ] Cards show message title/content summary + key property chips
- [ ] Drag card between columns → updates the groupBy property value
- [ ] `[+ Add]` at bottom of each column creates message with group value pre-filled
- [ ] Card click → navigate to message detail

**Verify:** `pnpm build:client` → no errors

**Steps:**

- [ ] **Step 1: Create `BoardView`** — Uses `useViewMessages(viewId)` with groupBy. Renders columns using `BoardColumn`.

- [ ] **Step 2: Create `BoardColumn` and `BoardCard`** — Column scrollable with pagination. Card shows summary + properties. Use `@dnd-kit/core` or similar for drag-and-drop.

- [ ] **Step 3: Handle drag-and-drop** — On drop, call `useSetProperty` mutation to update groupBy property value. Optimistic update.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(client): add board view with drag-and-drop"
```

---

### Task 17: Calendar View

**Goal:** Calendar view showing messages on date-type properties with month/week/day modes.

**Files:**

- Create: `apps/client/src/components/channel/views/CalendarView.tsx`
- Create: `apps/client/src/components/channel/views/CalendarMonth.tsx`
- Create: `apps/client/src/components/channel/views/CalendarWeek.tsx`
- Create: `apps/client/src/components/channel/views/CalendarDay.tsx`
- Create: `apps/client/src/components/channel/views/CalendarEventCard.tsx`

**Acceptance Criteria:**

- [ ] Renders messages on their date property cells
- [ ] `date_range` / `timestamp_range` → cross-date bars
- [ ] `recurring` → repeated on matching dates
- [ ] Month/week/day toggle
- [ ] Click empty date → create message with date pre-filled
- [ ] Drag card → change date property value
- [ ] Navigation: previous/next month/week/day

**Verify:** `pnpm build:client` → no errors

**Steps:**

- [ ] **Step 1: Create `CalendarView`** — State management for current view mode and date range. Queries messages filtered by date range.

- [ ] **Step 2: Create `CalendarMonth/Week/Day`** — Grid layouts. Month: 7×5/6 grid. Week: 7-column day view. Day: hourly timeline.

- [ ] **Step 3: Create `CalendarEventCard`** — Message summary displayed on date cells.

- [ ] **Step 4: Handle recurring expansion** — Client-side computation of recurring dates within visible range.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(client): add calendar view with month/week/day modes"
```

---

### Task 18: View Config Panel & Channel Settings

**Goal:** UI for configuring view filters/sorts/groups and managing property schema in channel settings.

**Files:**

- Create: `apps/client/src/components/channel/views/ViewConfigPanel.tsx`
- Create: `apps/client/src/components/channel/properties/PropertySchemaManager.tsx`
- Modify: `apps/client/src/components/channel/ChannelSettings.tsx` (or equivalent settings component)

**Acceptance Criteria:**

- [ ] View config panel: add/edit/remove filters, sorts, groupBy selection, visible properties toggle
- [ ] Filter builder: property selector → operator selector → value input (type-specific)
- [ ] Property schema manager: list all definitions, edit description/config/aiAutoFill/showInChatPolicy, delete (with confirmation for non-native), reorder
- [ ] Channel settings: `allowNonAdminCreateKey` toggle, `propertyDisplayOrder` toggle
- [ ] All changes persist via API and broadcast via WebSocket

**Verify:** `pnpm build:client` → no errors

**Steps:**

- [ ] **Step 1: Create `ViewConfigPanel`** — Popover/drawer with filter/sort/group sections.
- [ ] **Step 2: Create `PropertySchemaManager`** — List view with edit/delete actions per definition.
- [ ] **Step 3: Integrate into channel settings, commit**

```bash
git commit -m "feat(client): add view config panel and property schema manager"
```

---

### Task 19: AI Auto-Fill UI

**Goal:** Frontend UI for automatic and manual AI property generation.

**Files:**

- Create: `apps/client/src/components/channel/properties/AiAutoFillButton.tsx`
- Modify: `apps/client/src/components/channel/properties/MessageProperties.tsx`
- Modify: `apps/client/src/components/channel/properties/PropertyPanel.tsx`
- Modify: `apps/client/src/hooks/useMessages.ts`

**Acceptance Criteria:**

- [ ] Auto-fill triggers after message creation (if channel has `aiAutoFill=true` fields)
- [ ] Property chips show shimmer/skeleton during AI generation
- [ ] Retry status: "Retrying..." indicator (max 3 rounds)
- [ ] Failure: "AI fill failed" badge with manual entry fallback
- [ ] Manual trigger: ✨ icon on property chips, "AI Generate" in right-click menu
- [ ] Title field: AI generate button in message detail and table view
- [ ] Auto-fill on message edit re-evaluates properties

**Verify:** `pnpm build:client` → no errors

**Steps:**

- [ ] **Step 1: Create `AiAutoFillButton`** — ✨ sparkle icon that calls `useAutoFill` mutation with optional `fields` parameter.

- [ ] **Step 2: Add shimmer state to `MessageProperties`** — Track auto-fill loading state. Show skeleton chips during generation.

- [ ] **Step 3: Hook auto-fill into message creation flow** — In `useMessages`, after successful message send, if channel has AI-fillable fields, trigger auto-fill.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(client): add AI auto-fill UI with shimmer states and manual trigger"
```

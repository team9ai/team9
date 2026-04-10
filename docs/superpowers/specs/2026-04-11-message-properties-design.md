# Message Properties — 消息结构化属性系统

## Overview

为 Team9 的群组频道消息添加结构化属性系统，使每条消息除了 reaction 外，还能附加 tags、key-value pairs 等结构化数据。属性在频道层面共享 schema，支持 Table View、Board View、Calendar View 等多种视图。

### 核心愿景

**Channel 是 agent 之间的通信总线，结构化属性就是信号协议。**

消息的 content 是给人读的（自然语言），properties 是给机器读的（结构化数据）。人类和 agent 共享同一个频道 — 人类通过 table/board/calendar view 看到全局结构化状态，agent 通过 subscribe + query 消费和响应信号。

### Design Philosophy

- **Schema-on-write**：第一次使用时自动建立属性定义，零摩擦创建，事后治理
- **统一模型**：原生属性（tags/people/tasks/messages）和自定义属性走同一套 EAV 系统
- **频道即数据库**：Table/Board/Calendar View 让频道从时间线聊天升级为结构化协作空间
- **Agent-first**：属性系统天然为 agent 信号通讯设计，人类 UI 是可视化层

## Scope

### 支持的频道类型

- `public` (群组) ✅
- `private` (私有群组) ✅
- `direct` (私聊) ❌
- `task` ❌
- `tracking` ❌

### 支持的消息范围

- 根消息（非 thread reply）✅
- Thread reply ❌
- `text` / `long_text` / `file` / `image` 类型 ✅
- `system` / `tracking` 类型 ❌

## Data Model

### Value Types (16 种)

| #   | Type              | 存储列                 | 说明                                      |
| --- | ----------------- | ---------------------- | ----------------------------------------- |
| 1   | `text`            | textValue              | 文字                                      |
| 2   | `number`          | numberValue            | 数字                                      |
| 3   | `boolean`         | booleanValue           | 真假                                      |
| 4   | `single_select`   | textValue              | 单选                                      |
| 5   | `multi_select`    | jsonValue              | 多选                                      |
| 6   | `person`          | jsonValue              | 人员（单/多人）                           |
| 7   | `date`            | dateValue              | 仅日期                                    |
| 8   | `timestamp`       | dateValue              | 日期+时间                                 |
| 9   | `date_range`      | jsonValue              | 日期段 `{ "start": "...", "end": "..." }` |
| 10  | `timestamp_range` | jsonValue              | 时间段 `{ "start": "...", "end": "..." }` |
| 11  | `recurring`       | jsonValue              | 重复规则（iCal RRULE 简化版）             |
| 12  | `url`             | textValue              | URL 链接                                  |
| 13  | `message_ref`     | jsonValue              | 链接到别的消息                            |
| 14  | `file`            | fileKey + fileMetadata | 文件上传                                  |
| 15  | `image`           | fileKey + fileMetadata | 图片上传                                  |
| 16  | `tags`            | —                      | 原生 multi_select 语法糖                  |

### `channel_property_definitions` 表

频道级属性 schema 定义。

| 字段               | 类型                  | 说明                                                  |
| ------------------ | --------------------- | ----------------------------------------------------- |
| `id`               | UUID PK               | —                                                     |
| `channelId`        | UUID FK → channels    | —                                                     |
| `key`              | varchar(100)          | 属性名，频道内唯一。`_` 前缀保留给原生属性            |
| `description`      | text, nullable        | 属性描述                                              |
| `valueType`        | enum                  | 上述 16 种类型                                        |
| `isNative`         | boolean               | 原生属性不可删除、不可改类型                          |
| `config`           | JSONB                 | 类型专属配置（见下）                                  |
| `order`            | integer               | 频道内排序（原生属性排最前）                          |
| `aiAutoFill`       | boolean               | 是否启用 AI 自动填充                                  |
| `aiAutoFillPrompt` | text, nullable        | AI 填充的自定义 prompt                                |
| `isRequired`       | boolean               | 是否必填                                              |
| `defaultValue`     | JSONB, nullable       | 默认值                                                |
| `showInChatPolicy` | varchar(20)           | `"auto"` / `"show"` / `"hide"`，默认 `"auto"`         |
| `allowNewOptions`  | boolean, default true | 仅 single_select / multi_select：是否允许添加新选项值 |
| `createdBy`        | UUID FK → users       | —                                                     |
| `createdAt`        | timestamp             | —                                                     |
| `updatedAt`        | timestamp             | —                                                     |

**Unique constraint:** `(channelId, key)`

**`config` JSONB 结构（按类型）：**

- **single_select / multi_select:** `{ "options": [{ "value": "todo", "color": "#ff0000" }, ...] }`
- **person:** `{ "multiple": true/false }`
- **number:** `{ "format": "number" | "percent" | "currency" }`
- **date / timestamp:** `{ "includeTime": false }`
- **file / image:** `{ "maxSize": 10485760, "allowedMimeTypes": [...] }`
- 其余类型: `{}`

**原生属性（频道创建时自动插入）：**

| key         | valueType      | isNative | aiAutoFill 默认 |
| ----------- | -------------- | -------- | --------------- |
| `_tags`     | `multi_select` | true     | true            |
| `_people`   | `person`       | true     | true            |
| `_tasks`    | `message_ref`  | true     | true            |
| `_messages` | `message_ref`  | true     | true            |

特殊字段 `title`（非原生，但有特殊显示逻辑，aiAutoFill 默认 false）。

### `message_properties` 表

消息级属性值，一行一个属性。

| 字段                   | 类型                                   | 说明                                                                                     |
| ---------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------- |
| `id`                   | UUID PK                                | —                                                                                        |
| `messageId`            | UUID FK → messages (cascade)           | —                                                                                        |
| `propertyDefinitionId` | UUID FK → channel_property_definitions | —                                                                                        |
| `textValue`            | text, nullable                         | text / url / single_select                                                               |
| `numberValue`          | double precision, nullable             | number                                                                                   |
| `booleanValue`         | boolean, nullable                      | boolean                                                                                  |
| `dateValue`            | timestamp, nullable                    | date / timestamp                                                                         |
| `jsonValue`            | JSONB, nullable                        | 数组类型 (multi_select, person[], message_ref[], date_range, timestamp_range, recurring) |
| `fileKey`              | varchar(500), nullable                 | file / image 的存储 key                                                                  |
| `fileMetadata`         | JSONB, nullable                        | `{ "fileName", "fileUrl", "fileSize", "mimeType", "width", "height" }`                   |
| `order`                | integer                                | 属性在该消息上的挂载顺序                                                                 |
| `createdBy`            | UUID FK → users                        | —                                                                                        |
| `updatedBy`            | UUID FK → users, nullable              | —                                                                                        |
| `createdAt`            | timestamp                              | —                                                                                        |
| `updatedAt`            | timestamp                              | —                                                                                        |

**Unique constraint:** `(messageId, propertyDefinitionId)`

**CHECK constraint:** 同一行只有一个值列非 NULL（根据关联 definition 的 valueType）。

**Indexes:**

- `(messageId)` — 加载消息属性
- `(propertyDefinitionId, textValue)` — 文字属性筛选
- `(propertyDefinitionId, numberValue)` — 数字排序/范围
- `(propertyDefinitionId, dateValue)` — 日期排序/范围
- `(propertyDefinitionId, booleanValue)` — 布尔筛选
- `jsonValue` GIN — 数组包含查询

### `audit_logs` 表

通用审计日志，覆盖 channel、message 及其属性的所有变更。

| 字段          | 类型                         | 说明                                           |
| ------------- | ---------------------------- | ---------------------------------------------- |
| `id`          | UUID PK                      | —                                              |
| `channelId`   | UUID FK → channels, nullable | 所属频道                                       |
| `entityType`  | varchar(50)                  | `"channel"` / `"message"`                      |
| `entityId`    | UUID                         | 被修改的实体 ID                                |
| `action`      | varchar(50)                  | 见下表                                         |
| `changes`     | JSONB                        | `{ "field": { "old": ..., "new": ... }, ... }` |
| `performedBy` | UUID FK → users, nullable    | 操作人                                         |
| `metadata`    | JSONB, nullable              | 额外信息（如 AI 填充来源）                     |
| `createdAt`   | timestamp                    | —                                              |

**Action 值：**

| entityType | action                    | 场景           |
| ---------- | ------------------------- | -------------- |
| `channel`  | `updated`                 | 频道设置变更   |
| `channel`  | `property_defined`        | 新建属性定义   |
| `channel`  | `property_schema_updated` | 修改属性定义   |
| `channel`  | `property_deleted`        | 删除属性定义   |
| `message`  | `created`                 | 消息创建       |
| `message`  | `updated`                 | 消息内容编辑   |
| `message`  | `deleted`                 | 消息删除       |
| `message`  | `property_set`            | 首次设置属性值 |
| `message`  | `property_updated`        | 修改属性值     |
| `message`  | `property_removed`        | 移除属性值     |

**AI 操作的 metadata 示例：**

```json
{
  "source": "ai_auto_fill",
  "model": "claude-sonnet-4-6",
  "round": 1
}
```

**Indexes:**

- `(channelId, createdAt)` — 频道审计查询
- `(entityType, entityId)` — 实体变更历史
- `(performedBy, createdAt)` — 用户操作记录

### `channel_views` 表

| 字段        | 类型                         | 说明                                 |
| ----------- | ---------------------------- | ------------------------------------ |
| `id`        | UUID PK                      | —                                    |
| `channelId` | UUID FK → channels (cascade) | —                                    |
| `name`      | varchar(100)                 | 视图名称                             |
| `type`      | varchar(20)                  | `"table"` / `"board"` / `"calendar"` |
| `config`    | JSONB                        | 筛选、排序、分组、可见列等（见下）   |
| `order`     | integer                      | tab 排序                             |
| `createdBy` | UUID FK → users              | —                                    |
| `createdAt` | timestamp                    | —                                    |
| `updatedAt` | timestamp                    | —                                    |

**`config` JSONB：**

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

**Limits:** filter 条件 ≤ 10 个，sort 字段 ≤ 3 个。

### `channel_tabs` 表

| 字段        | 类型                              | 说明                                                                           |
| ----------- | --------------------------------- | ------------------------------------------------------------------------------ |
| `id`        | UUID PK                           | —                                                                              |
| `channelId` | UUID FK → channels (cascade)      | —                                                                              |
| `name`      | varchar(100)                      | tab 显示名                                                                     |
| `type`      | varchar(30)                       | `"messages"` / `"files"` / `"table_view"` / `"board_view"` / `"calendar_view"` |
| `viewId`    | UUID FK → channel_views, nullable | view 类型时关联具体视图                                                        |
| `isBuiltin` | boolean                           | 内置 tab 不可删除                                                              |
| `order`     | integer                           | 排序                                                                           |
| `createdBy` | UUID FK → users, nullable         | —                                                                              |
| `createdAt` | timestamp                         | —                                                                              |
| `updatedAt` | timestamp                         | —                                                                              |

**频道创建时自动插入：**

| name     | type       | isBuiltin | order |
| -------- | ---------- | --------- | ----- |
| Messages | `messages` | true      | 0     |
| Files    | `files`    | true      | 1     |

### 频道设置扩展

`channels` 表新增 `propertySettings` JSONB 列：

```json
{
  "allowNonAdminCreateKey": true,
  "propertyDisplayOrder": "schema"
}
```

| 配置项                   | 默认值     | 说明                                                          |
| ------------------------ | ---------- | ------------------------------------------------------------- |
| `allowNonAdminCreateKey` | `true`     | 非管理员是否可创建新属性 key                                  |
| `propertyDisplayOrder`   | `"schema"` | `"schema"`（按 schema 顺序）/ `"chronological"`（按添加顺序） |

## Permissions

权限跟随频道角色，核心原则：**能发消息就能操作属性，Schema 管理权限更宽泛。**

| 频道类型                  | 角色        | 发消息 | 挂/删属性 | 管理 Schema |
| ------------------------- | ----------- | ------ | --------- | ----------- |
| **Public** (默认)         | 所有成员    | ✅     | ✅        | ✅          |
| **Public** (仅管理员发送) | 普通成员    | ❌     | ❌        | ❌          |
| **Public** (仅管理员发送) | admin/owner | ✅     | ✅        | ✅          |
| **Private**               | 只读成员    | ❌     | ❌        | ❌          |
| **Private**               | 可写成员    | ✅     | ✅        | ✅          |
| **Private**               | admin/owner | ✅     | ✅        | ✅          |

**Content vs Properties 权限区分：**

- 编辑 Content：仅消息发送者本人
- 删除消息：发送者 + admin/owner
- 编辑 Properties：有写权限的所有成员（包括给别人的消息挂属性）

## API

### 属性 Schema 管理

| Method   | Endpoint                                                | 说明                            |
| -------- | ------------------------------------------------------- | ------------------------------- |
| `GET`    | `/v1/im/channels/:channelId/property-definitions`       | 列出频道所有属性定义            |
| `POST`   | `/v1/im/channels/:channelId/property-definitions`       | 创建属性定义                    |
| `PATCH`  | `/v1/im/channels/:channelId/property-definitions/:id`   | 修改属性定义                    |
| `DELETE` | `/v1/im/channels/:channelId/property-definitions/:id`   | 删除属性定义（isNative 不可删） |
| `PATCH`  | `/v1/im/channels/:channelId/property-definitions/order` | 批量调整排序                    |

### 消息属性值

| Method   | Endpoint                                              | 说明                |
| -------- | ----------------------------------------------------- | ------------------- |
| `GET`    | `/v1/im/messages/:messageId/properties`               | 获取消息的所有属性  |
| `PUT`    | `/v1/im/messages/:messageId/properties/:definitionId` | 设置/更新单个属性值 |
| `DELETE` | `/v1/im/messages/:messageId/properties/:definitionId` | 移除属性值          |
| `PATCH`  | `/v1/im/messages/:messageId/properties`               | 批量设置属性        |
| `POST`   | `/v1/im/messages/:messageId/properties/auto-fill`     | 触发 AI 自动填充    |

**批量设置 body：**

```json
{
  "properties": [
    { "key": "priority", "value": 3 },
    { "key": "status", "value": "in-progress" },
    { "key": "_tags", "value": ["urgent", "bug"] }
  ]
}
```

**AI auto-fill body：**

```json
{
  "fields": ["title", "status"],
  "preserveExisting": true
}
```

`fields` 可选，不传则生成所有 `aiAutoFill=true` 的字段。`preserveExisting` 手动触发时为 true。

### 频道视图

| Method   | Endpoint                                            | 说明                 |
| -------- | --------------------------------------------------- | -------------------- |
| `GET`    | `/v1/im/channels/:channelId/views`                  | 列出频道所有视图     |
| `POST`   | `/v1/im/channels/:channelId/views`                  | 创建视图             |
| `PATCH`  | `/v1/im/channels/:channelId/views/:viewId`          | 更新视图配置         |
| `DELETE` | `/v1/im/channels/:channelId/views/:viewId`          | 删除视图             |
| `GET`    | `/v1/im/channels/:channelId/views/:viewId/messages` | 查询视图数据（分页） |

**视图数据查询 — 分组分页 response：**

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
          "content": "登录页面有 bug...",
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

每组独立 cursor + total，前端按组懒加载。

### 频道 Tabs

| Method   | Endpoint                                 | 说明                         |
| -------- | ---------------------------------------- | ---------------------------- |
| `GET`    | `/v1/im/channels/:channelId/tabs`        | 列出频道所有 tab             |
| `POST`   | `/v1/im/channels/:channelId/tabs`        | 创建 tab                     |
| `PATCH`  | `/v1/im/channels/:channelId/tabs/:tabId` | 更新 tab                     |
| `DELETE` | `/v1/im/channels/:channelId/tabs/:tabId` | 删除 tab（isBuiltin 不可删） |
| `PATCH`  | `/v1/im/channels/:channelId/tabs/order`  | 批量调整排序                 |

### 审计日志

| Method | Endpoint                                | 说明                                                  |
| ------ | --------------------------------------- | ----------------------------------------------------- |
| `GET`  | `/v1/im/channels/:channelId/audit-logs` | 查询频道审计日志（分页，可按 entityType/action 过滤） |

### 现有消息 API 变更

`GET /v1/im/channels/:channelId/messages` response 每条消息新增 `properties` 字段（只返回 `showInChatPolicy !== "hide"` 的属性）。

`POST /v1/im/channels/:channelId/messages` 扩展 body，可选 `properties` 字段一并设置属性。

## WebSocket Events

### Server → Client（广播给频道成员）

| 事件                          | Payload                                             | 场景                             |
| ----------------------------- | --------------------------------------------------- | -------------------------------- |
| `property_definition_created` | `{ channelId, definition }`                         | 新属性定义（含 schema-on-write） |
| `property_definition_updated` | `{ channelId, definitionId, changes }`              | 属性 schema 变更                 |
| `property_definition_deleted` | `{ channelId, definitionId }`                       | 删除属性定义                     |
| `message_property_changed`    | `{ channelId, messageId, properties, performedBy }` | 消息属性值变更（统一事件）       |
| `view_created`                | `{ channelId, view }`                               | 新建视图                         |
| `view_updated`                | `{ channelId, viewId, changes }`                    | 视图配置变更                     |
| `view_deleted`                | `{ channelId, viewId }`                             | 删除视图                         |
| `tab_created`                 | `{ channelId, tab }`                                | 新建 tab                         |
| `tab_updated`                 | `{ channelId, tabId, changes }`                     | tab 变更                         |
| `tab_deleted`                 | `{ channelId, tabId }`                              | 删除 tab                         |

**`message_property_changed` payload：**

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

用统一的 `message_property_changed` 而非拆成 set/update/remove — 批量操作（AI auto-fill）可能同时 set 多个、remove 一些，单事件更高效。

## AI Auto-Fill

### 触发时机

- 消息创建后（自动，如有 `aiAutoFill=true` 的字段）
- 消息编辑后（自动，带 diff）
- 手动请求（指定 `fields`，`preserveExisting: true`）
- Table View 中点击 title 生成按钮

### Prompt 格式（XML）

```xml
<context>
  <channel>
    <name>Frontend Bug Tracker</name>
    <description>前端相关 bug 追踪与修复</description>
  </channel>

  <message>
    <content>登录页面在 Safari 下 CSS 错位，用户无法点击提交按钮。</content>
    <original_content>登录页面有个 bug</original_content>  <!-- 编辑触发时 -->
    <reactions>
      <reaction emoji="👀" count="2" />
      <reaction emoji="👍" count="1" />
    </reactions>
    <thread_replies>
      <reply sender="Bob">我来看看这个问题</reply>
      <reply sender="Carol">Safari 的 flexbox gap 属性不支持</reply>
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

  <generate_fields>  <!-- 手动指定时才有 -->
    <field>title</field>
    <field>status</field>
  </generate_fields>
</context>

<instructions>
  根据消息内容、频道上下文、讨论回复和当前属性，为指定字段生成合适的值。
  - 不需要修改的字段标记 unchanged
  - allow_new_options="false" 的字段只能使用已有选项，无匹配则返回 null
  - 只修改 ai_fill="true" 的字段
</instructions>
```

### AI 返回格式（function_call JSON）

```json
{
  "title": { "value": "登录页面 CSS 错位" },
  "status": { "value": "todo" },
  "priority": { "unchanged": true },
  "_tags": { "value": ["bug", "frontend"] },
  "_people": { "value": null }
}
```

- `{ "unchanged": true }` — 不更新
- `{ "value": ... }` — 设置新值
- `{ "value": null }` — 无法生成/无匹配选项

### 必填/可空规则

| 条件                                                 | 值是否可空              |
| ---------------------------------------------------- | ----------------------- |
| `aiAutoFill=true` 且尚未设值                         | 必须返回（可以是 null） |
| `allowNewOptions=false` 且无匹配选项                 | 可为 null               |
| `allowNewOptions=true` 且 `aiAutoFill=true` 且未设值 | 不可为空                |
| `aiAutoFill=false`                                   | AI 不可修改             |

### 原生属性默认 AI 填充配置

| 属性                 | aiAutoFill 默认 |
| -------------------- | --------------- |
| `title`              | false           |
| `_tags`              | true            |
| `_people`            | true            |
| `_tasks`             | true            |
| `_messages`          | true            |
| 自定义属性（新建时） | true            |

### 错误重试

校验返回值（类型匹配、选项存在、必填字段、只修改 `aiAutoFill=true` 的字段）。不通过则返回错误详情给 AI 重试，最多 3 轮。最终失败记录日志。

AI 填充结果记入 `audit_logs`，`performedBy=null`，`metadata.source="ai_auto_fill"`。

## Frontend Architecture

### Component Structure

```
channel/
├── ChannelHeader.tsx (现有)
│   └── ChannelTabs.tsx (新增)          ← tab 栏: Messages | Files | Views...
│
├── MessageList.tsx (现有，扩展)
│   └── MessageItem.tsx (现有，扩展)
│       ├── MessageContent.tsx (现有)
│       ├── MessageTitle.tsx (新增)      ← title 特殊字段
│       ├── MessageProperties.tsx (新增) ← 消息下方属性 chips
│       │   ├── PropertyTag.tsx
│       │   ├── PropertyPerson.tsx
│       │   ├── PropertyValue.tsx
│       │   └── PropertyMoreButton.tsx   ← [...] 展开更多
│       ├── MessageReactions.tsx (现有)
│       └── MessageHoverToolbar.tsx (现有，扩展)
│           └── + 属性按钮（📎）
│
├── views/ (新增)
│   ├── TableView.tsx
│   │   ├── TableHeader.tsx
│   │   ├── TableRow.tsx
│   │   ├── TableCell.tsx               ← 按类型渲染编辑器
│   │   └── TableAddRow.tsx             ← "+" 新增消息行
│   ├── BoardView.tsx
│   │   ├── BoardColumn.tsx             ← 分组列，独立滚动/分页
│   │   └── BoardCard.tsx
│   ├── CalendarView.tsx
│   │   ├── CalendarMonth.tsx
│   │   ├── CalendarWeek.tsx
│   │   ├── CalendarDay.tsx
│   │   └── CalendarEventCard.tsx
│   └── ViewConfigPanel.tsx
│
├── properties/ (新增)
│   ├── PropertyEditor.tsx              ← 按类型分发
│   │   ├── TextEditor / NumberEditor / BooleanEditor
│   │   ├── SelectEditor               ← 单选/多选 + 新建选项
│   │   ├── PersonPicker / DatePicker
│   │   ├── UrlEditor / MessageRefPicker / FileUploader
│   │   └── RecurringEditor
│   ├── PropertyPanel.tsx               ← 消息属性侧边栏
│   ├── PropertySelector.tsx            ← 属性选择器（子菜单模式）
│   └── PropertySchemaManager.tsx        ← 频道设置中 schema 管理
│
└── settings/ (现有，扩展)
    └── ChannelSettings.tsx → + PropertySchemaManager tab
```

### State Management

**React Query（服务端状态）：**

| Query Key                                            | 失效时机                                      |
| ---------------------------------------------------- | --------------------------------------------- |
| `["channel", channelId, "propertyDefinitions"]`      | WS `property_definition_*`                    |
| `["channel", channelId, "tabs"]`                     | WS `tab_*`                                    |
| `["channel", channelId, "view", viewId, "messages"]` | WS `message_property_changed` / `new_message` |

消息属性随消息一起加载（`properties` 字段），不需要额外查询。

**Zustand（UI 状态）：**

```typescript
interface PropertyUIState {
  activeTab: string;
  propertyPanelMessageId: string | null;
  viewConfigOpen: boolean;
}
```

## UI Interaction

### Chat View — 属性显示

**有属性时：**

```
消息气泡
├── [Title] 登录页面 CSS 错位
├── 消息正文...
├── [🏷 urgent] [🏷 bug] [👤 Alice] [⚡ 3] [📋 todo] [...]  ← [...] 在末尾
└── [👍 2] [❤️ 1]
```

**无属性时：**

```
消息气泡
├── 消息正文...
└── [👍 2] [❤️ 1] [+]  ← [+] 紧跟 reaction 后
```

**showInChatPolicy 控制：**

- `"show"` — 始终显示
- `"auto"` — 有值时显示
- `"hide"` — 只在 PropertyPanel 或 Views 中可见

**Hover toolbar（右上角浮动框）：**

```
[✅] [👀] [🙌] [😊] [💬] [📎] [🔖] [⋮]
 ↑──────────↑                  ↑
 最近用过的 emoji           属性按钮
```

### 属性选择器 — 子菜单模式

```
[...] 或 [+] 点击
  ↓
┌─────────────────────┐
│ 🔍 搜索...          │
├─────────────────────┤
│ 🏷 Tags         ▸  │──→ ┌──────────────────┐
│ 👤 People       ▸  │    │ 选项子菜单         │
│ priority        ▸  │    └──────────────────┘
│ status          ▸  │
├─────────────────────┤
│ [+ 创建新属性]       │  ← allowNonAdminCreateKey 控制
└─────────────────────┘
```

### 消息详情视图

**普通消息（有 tag/属性）：**

```
┌─────────────────────────────────────────────┐
│ [Title] 登录页面 CSS 错位     [✨ AI 生成]   │
├─────────────────────────────────────────────┤
│ 🏷 urgent  🏷 bug  🏷 frontend  [+]         │  ← tags 可删(×)
├─────────────────────────────────────────────┤
│ 消息正文                                     │
│ 登录页面在 Safari 下 CSS 错位...             │
├─────────────────────────────────────────────┤
│ 属性 (3/8)                    [展开全部 ▾]   │
│ ┌──────────┬──────────────────┐              │  ← Notion 风格表格
│ │ Status   │ ● todo          │              │
│ │ Priority │ 3               │              │
│ │ Assignee │ 👤 Alice        │              │
│ └──────────┴──────────────────┘              │
├─────────────────────────────────────────────┤
│ Thread + 属性变更记录混排                     │
│  👤 Bob: 我来看看                            │
│  ⚙ Alice 将 status 从 todo 改为 in-progress │
│  ⚙ AI 将 _tags 添加 css-fix                 │
└─────────────────────────────────────────────┘
```

**long_text 消息 — 属性在正文前：**

```
Title → Tags → 属性表格 → 消息正文（长文本） → Thread
```

**无 tag 无属性时：**

Tag 行和属性表格隐藏，右上角显示 [📎+] 添加入口。

**属性折叠规则：**

- ≤ 5 行：全部展示
- \> 5 行：折叠，只显示有值的属性（"有效属性"）
- 有效属性也超过 5 行：显示前 5 行 + `[展开全部 (N)]`

### Table View

```
┌──────────────────────────────────────────────────────────────┐
│ [筛选 ▾] [排序 ▾] [分组 ▾] [属性 ▾]          [⚙ 视图设置]    │
├────────┬──────────┬────────┬──────────┬───────┬─────────────┤
│ Title  │ Content  │ Status │ Priority │ Tags  │ Assignee    │
├────────┼──────────┼────────┼──────────┼───────┼─────────────┤
│ 登录bug │ 登录页... │ ● todo │    3     │ 🏷bug │ 👤 Alice    │
│ 新功能  │ 添加暗... │ ● done │    1     │ 🏷feat│ 👤 Bob      │
│ [+ 新消息]                                                   │
└──────────────────────────────────────────────────────────────┘
```

- 单元格点击 → inline 编辑
- Content 列：发送者本人可编辑，他人只读
- Title 列点击 → 进入消息详情
- 有 groupBy 时：每组单独分页，独立 cursor
- 列头可拖拽调整宽度和顺序

### Board View

```
┌─────────────┬─────────────┬─────────────┐
│   📋 Todo   │ 🔄 Progress │  ✅ Done     │
├─────────────┼─────────────┼─────────────┤
│ ┌─────────┐ │ ┌─────────┐ │ ┌─────────┐ │
│ │ 登录bug  │ │ │ 新功能   │ │ │ 文档更新 │ │
│ │ 🏷bug    │ │ │ 🏷feat   │ │ │ 🏷docs  │ │
│ │ 👤Alice  │ │ │ 👤Bob    │ │ │ 👤Carol │ │
│ └─────────┘ │ └─────────┘ │ └─────────┘ │
│ [+ 添加]    │ [+ 添加]    │ [+ 添加]    │
└─────────────┴─────────────┴─────────────┘
```

- 按任意 single_select 属性分组
- 卡片拖拽 → 修改分组属性值
- 每列独立滚动/分页
- `[+ 添加]` → 创建消息并预填分组值

### Calendar View

- `date` / `timestamp` 属性 → 对应日期格显示卡片
- `date_range` / `timestamp_range` → 跨日期横条
- `recurring` → 每个匹配日期重复显示
- 点击日期空白处 → 创建消息预填该日期
- 拖拽卡片 → 修改日期
- 月/周/日三种粒度切换

### AI Auto-Fill UI

```
消息发送后（自动填充）:
  属性区域显示 shimmer 加载状态 → AI 返回值渐入
  重试 → "正在重试..." (最多 3 轮) → 失败 → "AI 填充失败" + 手动入口

手动触发:
  属性 chip ✨ 图标 / 右键 "AI 生成"
  → 指定字段 loading spinner → 完成 highlight 动画
```

## Agent Integration

> **TODO:** Agent 集成需要更细致整体的讨论，后续单独设计。以下为概要方向。

### 交互模式概要

- **Subscribe:** Agent 通过 WebSocket 监听 `message_property_changed` / `new_message` 事件
- **Query:** Agent 通过 REST API 按属性筛选消息（复用视图查询接口）
- **Write:** Agent 发送消息时可一并设置属性，也可修改已有消息的属性
- Agent 权限与普通用户一致，取决于频道成员角色

### Agent 发送带属性的消息

```json
// POST /v1/im/channels/:channelId/messages
{
  "content": "已完成代码审查，发现 3 个问题",
  "properties": {
    "_tags": ["code-review"],
    "status": "review-done",
    "issueCount": 3
  }
}
```

### 信号模式示例

- **任务编排:** Agent A 发消息设 `status: pending` → Agent B 监听到 → 处理 → 设 `status: done` → Agent C 汇总
- **状态机驱动:** 每次 `status` 变更都是 WebSocket 事件，Agent 根据状态转换执行对应逻辑

## Performance

### 查询策略

- **聊天视图:** 两次查询 — 先查消息 IDs，再批量查 `message_properties WHERE messageId IN (...)`，前端合并。与现有 reactions/attachments 加载模式一致。
- **Table/Board/Calendar View:** cursor-based 分页，每个排序/筛选属性一次 LEFT JOIN。有 groupBy 时每组独立分页。

### 限制

| 限制项                        | 上限 |
| ----------------------------- | ---- |
| 每频道属性定义数              | 50   |
| 每条消息属性值数              | 50   |
| 每个视图 filter 条件数        | 10   |
| 每个视图 sort 字段数          | 3    |
| 每个 multi_select/tags 选项数 | 200  |
| 每个 person 属性人数          | 50   |
| 每频道视图数                  | 20   |

### 索引

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

### 缓存

| 缓存项          | 存储        | TTL             | 失效                            |
| --------------- | ----------- | --------------- | ------------------------------- |
| 频道属性 schema | Redis       | 10min           | WS `property_definition_*` 清除 |
| 视图配置        | Redis       | 10min           | WS `view_*` 清除                |
| 前端属性 schema | React Query | staleTime: 5min | WS 事件 refetch                 |

消息属性值不单独缓存，跟随消息加载策略。

## Edge Cases

| 场景                         | 处理方式                                           |
| ---------------------------- | -------------------------------------------------- |
| 删除属性定义                 | 确认弹窗 → 删除定义 + 级联删除所有消息上该属性的值 |
| 修改属性类型                 | 禁止。要改类型只能删除重建                         |
| 两人同时编辑同一属性         | Last-write-wins，前端 WebSocket 实时同步           |
| 消息删除                     | 级联删除属性（现有 cascade）                       |
| 频道归档                     | 视图/属性只读                                      |
| 删除 select 选项（已使用中） | 确认弹窗，已使用该选项的消息值置为 null            |
| 原生属性                     | 不可删除、不可改类型                               |
| key 命名冲突                 | `_` 前缀保留给原生属性，用户 key 不允许 `_` 开头   |

## Known Issues to Fix

- **P1:** Hover toolbar 位置过于靠近右边缘
- **Bug:** 消息详情（消息列视图）中 reaction 未显示
- **Note:** 通知频道使用 📢 线框图标

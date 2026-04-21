# Message Parent-Child Relations Design

**Date:** 2026-04-21
**Status:** Draft (pending user review)
**Author:** Design session with Claude

## Goal

Add structured parent-child and soft-related relationships between messages, built on the existing channel-property / multi-dim-table (Notion-like) layer. Enable task-like hierarchical display in table view and chat bubbles without introducing a new first-class "task" entity.

## Scope

- Extend the existing `message_ref` property value type.
- Add a dedicated `im_message_relations` table as the single source of truth for relation-kind references.
- Provide a `parentMessage` (single, same-channel) and `relatedMessages` (multi, same-channel) shortcut in the "add property" UI.
- Auto-derive parent for thread replies via COALESCE (stored relation wins over thread `parentId`).
- Render hierarchy in table view (indented, collapsible) and in message bubble chips (parent / children / related / inbound-related).
- WebSocket event for relation changes.

## Non-goals (MVP)

- AI auto-fill for `parentMessage`.
- Closure-table materialization for subtree queries.
- Moving a message into a different thread (`parentId` mutation).
- A cross-channel relation feature (scope locked to same-channel for the shortcut types).
- Multi-parent / DAG semantics (single parent only; use `relatedMessages` for soft links).

## Background

The codebase already has:

- `im_messages` with `parentId` + `rootId` for thread replies (see [messages.ts](apps/server/libs/database/src/schemas/im/messages.ts)).
- 16 property value types including `message_ref` stored as `jsonValue` in `im_message_properties` (see [property.types.ts](apps/server/libs/shared/src/types/property.types.ts)).
- `channel_views` with filter / sort / groupBy but no hierarchy mode ([channel-views.ts](apps/server/libs/database/src/schemas/im/channel-views.ts)).
- `im_audit_logs` for property change auditing.
- A WebSocket event `message_property_changed` broadcast per channel.
- `channelType` includes `'task'`, but it is per-routine-execution (one task = one channel), not a "task database" channel.

Parent-child for tasks-as-messages does not exist today. `message_ref` is a generic untyped reference (no FK, no reverse index, no cycle checks).

## Design Decisions Summary

| Decision                    | Chosen                                                                                  |
| --------------------------- | --------------------------------------------------------------------------------------- |
| Cardinality model           | Single parent + multi related (Notion-style)                                            |
| Value type strategy         | Extend `message_ref` with `config.scope` + `config.cardinality` + `config.relationKind` |
| Storage source of truth     | New `im_message_relations` table (jsonb path retired for `relationKind` properties)     |
| Seeding                     | No automatic seeding; `PropertyAddMenu` offers "父任务 / 关联任务" shortcuts            |
| Parent vs thread `parentId` | Read-time COALESCE; explicit relation > thread > null; explicit-clear flag              |
| Cycle detection             | Write-time `WITH RECURSIVE` over relations ∪ thread parentId                            |
| Deleted target              | Preserve reference; UI renders `[已删除]` placeholder                                   |
| Related bidirectionality    | Store one-way; compute `incomingRelations` via reverse index at read                    |
| View rendering              | Table hierarchy mode (indent + collapse) + chat-bubble chip bar                         |
| Data-loading                | Filter hits + ancestor chain + descendants pre-loaded to depth 3, lazy deeper           |

## Architecture

```
DB
├── im_message_relations              [new]
├── im_channel_property_definitions   [extend config schema]
├── im_message_properties             [unchanged schema; behavior branches on config.relationKind]
└── im_messages                       [unchanged]

Backend (gateway)
├── im/properties/message-properties.service.ts     [branch on relationKind]
├── im/properties/message-relations.service.ts      [new — all edge ops, cycle detect, subtree query]
├── im/messages/messages.service.ts                 [read effective-parent when assembling message DTOs]
├── im/views/views.service.ts                       [tree endpoint for hierarchy mode]
└── im/websocket/websocket.gateway.ts               [new events]

Frontend (client)
├── services/api.ts                                 [new endpoints]
├── services/websocket.ts                           [new event listeners]
├── components/properties/
│   ├── MessageRefChip.tsx                          [states: normal / deleted / no-permission; thread-source badge]
│   ├── MessageRefPicker.tsx                        [scope-aware search]
│   └── PropertyAddMenu.tsx                         [shortcut entries]
├── components/views/table/
│   ├── TableView.tsx                               [hierarchy mode integration]
│   ├── TableRow.tsx                                [indent, expand arrow, ancestor-dim style]
│   ├── TableHierarchyToolbar.tsx                   [toggle + default depth]
│   └── useTreeLoader.ts                            [lazy loader hook]
├── components/message/MessageBubble.tsx            [parent/children/related chip row]
└── hooks/useMessageRelations.ts                    [relation queries + cache]
```

**Component boundaries:**

- `message-relations.service` owns edge CRUD, cycle checks, and graph queries. It knows nothing about UI or property semantics beyond `relationKind`.
- `message-properties.service` keeps its public interface intact; internally it delegates to `message-relations.service` for `relationKind` properties.
- View layer consumes a flat node list (`messageId`, `effectiveParentId`, `parentSource`, `depth`, `hasChildren`) and is unaware of storage details.

## Data Model

### New table: `im_message_relations`

```sql
CREATE TYPE relation_kind_enum AS ENUM ('parent', 'related');

CREATE TABLE im_message_relations (
  id                        uuid PRIMARY KEY,
  tenant_id                 uuid REFERENCES tenants(id) ON DELETE CASCADE,
  channel_id                uuid NOT NULL REFERENCES im_channels(id) ON DELETE CASCADE,
  source_message_id         uuid NOT NULL REFERENCES im_messages(id) ON DELETE CASCADE,
  target_message_id         uuid NOT NULL REFERENCES im_messages(id) ON DELETE CASCADE,
  property_definition_id    uuid NOT NULL REFERENCES im_channel_property_definitions(id) ON DELETE CASCADE,
  relation_kind             relation_kind_enum NOT NULL,
  created_by                uuid REFERENCES users(id),
  created_at                timestamp NOT NULL DEFAULT now(),
  CONSTRAINT uniq_edge UNIQUE (source_message_id, property_definition_id, target_message_id),
  CONSTRAINT no_self_ref CHECK (source_message_id <> target_message_id)
);

CREATE INDEX idx_mr_source_kind  ON im_message_relations (source_message_id, relation_kind);
CREATE INDEX idx_mr_target_kind  ON im_message_relations (target_message_id, relation_kind);
CREATE INDEX idx_mr_channel_kind ON im_message_relations (channel_id, relation_kind);
CREATE INDEX idx_mr_propdef      ON im_message_relations (property_definition_id);
```

**Constraint layering:**

- DB: FK cascade (delete message → delete edges), `UNIQUE` edge dedup, `CHECK` no self-ref.
- Service: same-channel validation (source.channelId == target.channelId == row.channelId), cardinality enforcement, cycle detection, scope validation from property definition config, at-most-one `relationKind='parent'` property definition per channel.

### Property definition config extension

`im_channel_property_definitions.config` (JSONB) for `valueType = 'message_ref'`:

```ts
interface MessageRefConfig {
  scope: "same_channel" | "any"; // default 'any' (legacy)
  cardinality: "single" | "multi"; // default 'multi' (legacy)
  relationKind?: "parent" | "related"; // present → edges stored in im_message_relations; absent → legacy jsonb path
}
```

### Migration

- Existing `message_ref` property rows are untouched (no `relationKind` → jsonb path preserved).
- New `im_message_relations` table created empty; no data backfill required.
- `PropertyAddMenu` "父任务 / 关联任务" entries create new definitions with `relationKind` set.

### Read / Write routing

```
WRITE message_property (messageId, propertyKey, value):
  definition = lookup(propertyKey, channelId)
  if definition.config.relationKind:
      in txn:
          diff = compute(old_edges, new_target_ids)
          validate scope, cardinality, cycles (WITH RECURSIVE)
          DELETE removed edges
          INSERT added edges
          UPSERT im_message_properties row with jsonValue = null
            (when value == null: { explicitlyCleared: true })
          emit audit_log + ws events
  else:
      legacy jsonValue write path (unchanged)

READ message_property:
  row = im_message_properties (messageId, propertyDefId)
  if definition.config.relationKind:
      edges = SELECT ... FROM im_message_relations
                WHERE source = messageId AND property_definition_id = ...
      return { value: edges.map(e => e.target_message_id) }
  else:
      return { value: row.jsonValue }
```

The outbound DTO shape is unchanged; callers see a `messageId` or `messageId[]`.

### Why keep a row in `im_message_properties`

- Preserves uniform `hasAnyPropertyValue` / "which properties are set on this message" semantics.
- Holds the `explicitlyCleared` flag.
- Gives a single place to stamp `updatedAt` / `updatedBy` for audit.

`jsonValue` on such rows is either `null` or `{ explicitlyCleared: true }`. It never stores IDs.

### Audit log

Writes to relation edges generate one `audit_logs` row per property change (not per edge). `detail.addedTargetIds` / `detail.removedTargetIds` are recorded. Action type reuses `message_property_changed`.

## API

### Unchanged endpoints (behavior differs internally by `relationKind`)

```
PUT    /v1/im/messages/:messageId/properties/:definitionId
DELETE /v1/im/messages/:messageId/properties/:definitionId
GET    /v1/im/messages/:messageId/properties
PATCH  /v1/im/messages/:messageId/properties
```

### New endpoint: relation inspection

```
GET /im/messages/:messageId/properties/relations
  ?kind=parent|related|all          (default 'all')
  &direction=outgoing|incoming|both (default 'both')
  &depth=<1..10>                    (default 1; applies only to parent kind)

Response:
{
  outgoing: {
    parent:  [{ messageId, depth, propertyDefinitionId, parentSource: 'relation' | 'thread' }],
    related: [{ messageId, propertyDefinitionId }]
  },
  incoming: {
    children:  [{ messageId, depth, propertyDefinitionId, parentSource: 'relation' | 'thread' }],
    relatedBy: [{ messageId, propertyDefinitionId }]
  }
}
```

### New endpoint: hierarchy tree for table view

```
GET /im/channels/:channelId/views/:viewId/tree
  ?filter=<json>        (reuses existing view filter DTO)
  &sort=<json>
  &maxDepth=<0..5>      (default 3)
  &expandedIds=<id,...> (additional nodes to expand a further level)
  &cursor=<string>
  &limit=<number>       (default 50 root-level matches per page)

Response:
{
  nodes: [
    {
      messageId,
      effectiveParentId,          // COALESCE(relation.parent, thread.parentId, null)
      parentSource: 'relation' | 'thread' | null,
      depth,                      // from the fetch root
      hasChildren: boolean,
      childrenLoaded: boolean
    }
  ],
  nextCursor: string | null,
  ancestorsIncluded: string[]     // auto-included ancestors of filter hits (rendered dim)
}
```

Internal algorithm:

1. Apply filter → hit set H.
2. For each id in H, walk effective-parent chain upward → ancestor set A.
3. Roots = { m ∈ H ∪ A : effective_parent(m) == null }, paginated by sort + cursor.
4. For each root, `WITH RECURSIVE` descend up to `maxDepth` levels.
5. For each id in `expandedIds`, fetch one additional level of children.
6. Return flat nodes + `nextCursor`.

### Cycle detection (internal)

Before writing a `parent`-kind edge `(source, target)`:

```sql
WITH RECURSIVE ancestors(m, depth) AS (
  SELECT target_message_id, 1
    FROM im_message_relations
    WHERE source_message_id = :newTargetId AND relation_kind = 'parent'
  UNION ALL
  SELECT msg.parent_id, 1
    FROM im_messages msg
    WHERE msg.id = :newTargetId AND msg.parent_id IS NOT NULL
  UNION ALL
  SELECT r.target_message_id, a.depth + 1
    FROM im_message_relations r JOIN ancestors a ON r.source_message_id = a.m
    WHERE r.relation_kind = 'parent' AND a.depth < 10
  UNION ALL
  SELECT msg2.parent_id, a.depth + 1
    FROM im_messages msg2 JOIN ancestors a ON msg2.id = a.m
    WHERE msg2.parent_id IS NOT NULL AND a.depth < 10
)
SELECT m, depth FROM ancestors WHERE m = :sourceMessageId OR depth >= 10 LIMIT 1;
```

Return row with `m = sourceMessageId` → reject with `RELATION_CYCLE_DETECTED`. Row with `depth >= 10` and no self-hit → reject with `RELATION_DEPTH_EXCEEDED`. Recursion is bounded by the `depth < 10` guard so the CTE always terminates.

### Error codes

- `RELATION_CYCLE_DETECTED`
- `RELATION_DEPTH_EXCEEDED` — ancestor chain would reach 10 levels
- `RELATION_SCOPE_VIOLATION` — cross-channel target with scope=same_channel
- `RELATION_CARDINALITY_EXCEEDED` — single-cardinality already has a value and replace is disallowed (current MVP: auto-replace, not thrown)
- `RELATION_SELF_REFERENCE`
- `RELATION_TARGET_NOT_FOUND` — target missing or user lacks read permission
- `RELATION_DEFINITION_CONFLICT` — attempting to create a second `relationKind='parent'` property definition on the same channel

### Permissions

Reuses existing property permission rules. Users who can edit properties can write relations; users who can read properties can read relations.

## COALESCE Semantics and Thread Interaction

### Effective parent

```
effective_parent(msg):
  row = im_message_properties (msg, parentDefId)
  if row && row.jsonValue?.explicitlyCleared:
      return null
  rel = im_message_relations (source=msg, kind='parent', limit 1)
  if rel:
      return { id: rel.target, source: 'relation' }
  if msg.parent_id:
      return { id: msg.parent_id, source: 'thread' }
  return null
```

Invariant: explicit relation > thread parentId > null. `explicitlyCleared` forces null even with a thread reply.

### Operation matrix

| Scenario                                              | Effect                                                                                                    |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Thread reply created, props set on it                 | No relation row. `effective = parentId` (`source='thread'`).                                              |
| Set `parentMessage = X` on a reply where X ≠ parentId | Write relation `(msg, X, parent)`. `effective = X` (`source='relation'`).                                 |
| Set `parentMessage = parentId` (explicit match)       | Service detects equivalence; no relation row written. `effective = parentId` (`source='thread'`).         |
| Set `parentMessage = null` on a reply                 | Upsert `message_properties.jsonValue = { explicitlyCleared: true }`. No relation row. `effective = null`. |
| Non-reply set `parentMessage = Y`                     | Standard relation write.                                                                                  |
| parent row later soft-deleted                         | Reference preserved. UI renders `[已删除]` + maintains tree position.                                     |

### Rationale

Keeps storage single-purpose: `im_message_relations` holds only live forward edges. `im_message_properties.jsonValue` carries the "explicitly cleared" tombstone when needed. Thread-derived parents impose no write cost; users can override at any point without mutating thread structure.

### Conflict policy

Task tree and thread tree may diverge — this is intentional. A reply in thread A can have its `parentMessage` set to C; the task view places it under C, while chat-thread UI still groups it under A. No warnings block the save (design decision: trust the user's explicit intent).

## Frontend

### PropertyAddMenu shortcuts

Add a grouped section "任务关系" with two entries:

- **父任务** → creates definition with `{ scope: 'same_channel', cardinality: 'single', relationKind: 'parent' }`, default key `parentMessage`.
- **关联任务** → same but `{ cardinality: 'multi', relationKind: 'related' }`, default key `relatedMessages`.

Backend enforces at most one `relationKind='parent'` definition per channel. Multiple `relationKind='related'` definitions allowed (e.g., "blocks", "duplicates").

### MessageRefChip states

| Target state              | Rendering                                                                          |
| ------------------------- | ---------------------------------------------------------------------------------- |
| Normal                    | Avatar + first-line snippet; click jumps to message.                               |
| `isDeleted`               | Strike-through gray + `[已删除]`; click disabled or jumps to position placeholder. |
| No read permission        | `[无权限]`; no interaction.                                                        |
| `parentSource='thread'`   | Small 🧵 corner badge.                                                             |
| `parentSource='relation'` | No badge.                                                                          |

### MessageBubble chip bar

Rendered below the bubble body when the message has any relation:

```
↑ 父: [chip B]
↓ 子: [chip C] [chip D] +3
↔ 关联: [chip E] [chip F]
← 被关联: [chip G]
```

- Only 1 level (direct parent / direct children / outgoing & incoming related).
- Overflow collapses to `+N`; popover lists the rest.
- Data fetched via `GET /messages/:id/relations?depth=1`, cached per-message in React Query.

### TableView hierarchy mode

Toolbar:

- "层级视图" toggle (mutually exclusive with groupBy).
- Default depth selector (0–5, default 3).
- 展开全部 / 折叠全部.

Row rendering:

- Indent = `16px * depth`.
- Expand arrow ▸/▾ when `hasChildren`.
- Ancestor-only rows (not matching filter but needed for continuity) rendered with gray background + thin left vertical rule.
- Root rows paginate by sort + cursor; "加载更多" button at bottom.

Lazy loading (`useTreeLoader`):

- Initial: `GET /views/:vid/tree?maxDepth=3&limit=50`.
- Expand node X without `childrenLoaded`: `GET /views/:vid/tree?expandedIds=[X]&maxDepth=1`, merge into local tree.
- On `message_relation_changed`: locate nearest loaded ancestor of `sourceMessageId`, refetch its first children level.

### MessageRefPicker

- Reads `config.scope` from the definition.
- `scope='same_channel'` restricts the search index to the current channel.
- `cardinality='single'` with a prior value → preview shows the replacement.
- Disables self-selection.

### React Query cache keys

```
['relations', messageId, 'depth1']
['view-tree', channelId, viewId, filterHash]
['relations-inbound', messageId]
```

WebSocket invalidation:

- `message_relation_changed { sourceId, targetIds[], kind, action }` →
  - invalidate `['relations', sourceId, *]`
  - invalidate `['relations-inbound', targetId]` for each affected target
  - invalidate `['view-tree', channelId, *]`

## WebSocket Events

### New: `message_relation_changed`

```ts
{
  channelId: string,
  sourceMessageId: string,
  propertyDefinitionId: string,
  propertyKey: string,
  relationKind: 'parent' | 'related',
  action: 'added' | 'removed' | 'replaced',
  addedTargetIds: string[],
  removedTargetIds: string[],
  currentTargetIds: string[],
  actorId: string,
  timestamp: string,
}
```

One event covers create / delete / single-cardinality replace. `replaced` populates both `addedTargetIds` and `removedTargetIds`.

### Existing: `message_property_changed`

Still emitted for `relationKind` properties. Its payload omits target IDs (those are in the relation event) but includes the optional flag:

```ts
{ ..., relationKind?: 'parent' | 'related', explicitlyCleared?: boolean }
```

Clients branch: if `relationKind` is present, the event only signals audit / clear-flag changes; target-set updates come exclusively from `message_relation_changed`. For legacy `message_ref`, the existing `value` payload is unchanged.

Order guarantee: `message_relation_changed` emitted before `message_property_changed` for the same change.

### Explicit-clear

Triggers:

1. `message_relation_changed` with `action='removed'` (if a prior relation existed).
2. `message_property_changed` carrying `explicitlyCleared: true`.

Client applies both and suppresses thread-parentId fallback for that message.

### Cascading deletion

When a message is soft-deleted, FK CASCADE removes all edges referencing it. A single summary event:

```
message_relations_purged { channelId, deletedMessageId, affectedSourceIds: string[] }
```

is emitted so clients can invalidate caches without reasoning about individual edges. The backend computes `affectedSourceIds` with a single SELECT before deletion.

### Rooms and reconnection

- All relation events broadcast on the existing channel room.
- On WS reconnect, clients invalidate all `['relations', *]` and `['view-tree', *]` keys and refetch.

### Ordering / idempotency

- `currentTargetIds` when present is authoritative; clients overwrite local cache.
- Absent `currentTargetIds` → apply `added/removed` diff.
- Out-of-order arrival: drop events with older `timestamp` than last seen for same `(sourceMessageId, propertyDefinitionId)`.

## Testing Strategy

### Backend unit tests — `message-relations.service.spec.ts`

CRUD:

- Create / replace parent edge (single cardinality).
- Create / append / de-duplicate related edges.
- Delete edge: single, by property definition, cascade via FK.
- UNIQUE collision handling.

Cycle detection:

- Direct cycle A→B→A rejected.
- Indirect A→B→C→A rejected.
- Thread-derived cycle (A thread-reply of B; setting B.parent=A with A already effective-parented to B) rejected.
- Depth > 10 rejected.
- Legal promotion accepted.

COALESCE effective parent:

- No parentId, no relation → null.
- parentId only → thread-derived.
- Relation overrides parentId.
- `explicitlyCleared` forces null.
- Relation to deleted target → preserved with `deletedAt`.
- Cross-channel target under scope=same_channel → rejected.

Reverse index:

- `incomingRelations` correctness.
- Filters out deleted sources.

Scope / cardinality:

- scope='any' allows cross-channel.
- scope='same_channel' rejects cross-channel.
- single cardinality auto-replaces on second write.
- multi appends.

### Backend unit tests — `message-properties.service.spec.ts` (updated)

- Writing a `relationKind` property: values go to relations table, not `jsonValue`.
- Reading re-assembles from relations.
- Legacy `message_ref` (no `relationKind`) still round-trips through `jsonValue`.
- `value: null` on `relationKind` property sets `explicitlyCleared`.
- Coexistence: legacy and new on the same message stay independent.

### Integration tests (`apps/server/apps/gateway/test/message-relations.e2e-spec.ts`)

Real PostgreSQL (per CLAUDE.md). Covers:

- End-to-end PUT → relation table state → GET tree consistency.
- Transactional rollback on mid-write failure.
- `message_relations_purged` emitted on soft-delete.
- CTE cycle detection on real schema.
- Concurrent writers competing on a single-cardinality field (UNIQUE wins exactly one).

### Frontend component tests

- `MessageRefChip`: normal / deleted / no-permission.
- `MessageBubble` chip bar overflow + click-through.
- `TableView hierarchy`: indent, expand/collapse, ancestor dim.
- `useTreeLoader`: expandedIds merge, WS invalidation.
- `MessageRefPicker`: scope-restricted search.

### Boundary / bad-case

- Depth = 10 passes, 11 rejects.
- 10k-message channel hierarchy view benchmark.
- Empty `currentTargetIds` forces diff application.
- Out-of-order WS events rejected by timestamp.
- Parent chain with mid-chain deleted node still renders via placeholder.
- Two distinct `relationKind='related'` definitions (e.g., "blocks" vs "duplicates") on the same message remain independent.

### Regression (CLAUDE.md requirement)

- Legacy `message_ref` properties behave identically after migration.
- Existing thread + property combinations unaffected.
- Zero data loss on migration.

### Out of scope

- AI auto-fill for `parentMessage`.
- Move-to-thread.
- Closure-table optimization.

## Rollout

1. Ship schema migration (additive).
2. Ship backend: `message-relations.service`, property read/write branching, tree endpoint, cycle detector.
3. Ship WS events.
4. Ship frontend shortcuts, chip rendering, table hierarchy mode, message-bubble chip bar.
5. Dogfood in an internal task-tracking channel. Verify chat + table UX end-to-end.

No feature flag required; the behavior change is gated by whether a `relationKind`-configured property definition exists in a channel.

## Open Items

None at spec time. Items deferred (AI auto-fill, closure-table, move-to-thread) are explicitly out of MVP.

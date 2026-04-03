# Team9 Hive Agent Metadata Sync Design

## Summary

Team9 needs to send searchable metadata to `agent-hive` when registering hive-backed agents and keep that metadata in sync when bot mentorship changes.

The metadata contract is intentionally small and owned by Team9:

```json
{
  "tenantId": "uuid",
  "botId": "uuid",
  "mentorId": "uuid|null"
}
```

This design covers:

- writing the metadata when Team9 registers hive agents
- synchronizing the metadata for every `managedProvider = 'hive'` bot when `mentorId` changes
- failing the mentor update request if hive cannot be updated consistently

This design does not include bulk backfill of already-registered hive agents.

## Goals

- Make `agent-hive` agent list filtering work for `blueprintId`, `metadata.tenantId`, `metadata.botId`, and `metadata.mentorId`.
- Treat Team9 as the source of truth for the three metadata fields above.
- Ensure all mentor updates for hive-managed bots go through one shared synchronization path.
- Prevent the common inconsistent state where Team9 updates `mentorId` but hive metadata remains stale.

## Non-Goals

- No metadata backfill job for agents already registered before this change.
- No expansion of the metadata contract beyond `tenantId`, `botId`, and `mentorId`.
- No asynchronous outbox or eventual-consistency workflow.
- No change to unmanaged bots or `managedProvider = 'openclaw'`.

## Current State

`BaseModelStaffHandler` creates hive-managed bots and registers corresponding agents in `agent-hive`, but the registration request currently omits agent metadata.

`BotService.updateBotMentor()` updates `im_bots.mentor_id` in Team9 only. It does not update the corresponding hive agent, even when the bot is managed by hive.

`agent-hive` now supports create, update, and filtering on agent `metadata`, but Team9 does not yet populate those fields.

## Proposed Design

### 1. Team9-owned metadata contract

Team9 will always write the full metadata object for hive-managed agents as:

```ts
type HiveAgentMetadata = {
  tenantId: string;
  botId: string;
  mentorId: string | null;
};
```

The object is replaced as a whole on every update. Team9 will not partially patch nested metadata fields.

### 2. Hive client responsibilities

`apps/server/libs/claw-hive/src/claw-hive.service.ts` will expose a new `updateAgent()` method that issues:

- `PUT /api/agents/:agentId`
- authenticated with the existing hive headers
- request body containing the full `metadata` object

This keeps all Team9-to-hive write semantics in one client service instead of duplicating raw fetch logic in handlers or controllers.

### 3. Creation path

`apps/server/apps/gateway/src/applications/handlers/base-model-staff.handler.ts` will include metadata in the `registerAgents()` payload for each created agent:

```json
{
  "metadata": {
    "tenantId": "<workspace tenant id>",
    "botId": "<im_bots.id>",
    "mentorId": "<installedBy>"
  }
}
```

The existing `managedMeta.agentId` field in Team9 remains the lookup key for later sync calls. The new hive metadata is not duplicated into `managedMeta`; it is only sent to hive.

### 4. Mentor update path

`apps/server/apps/gateway/src/bot/bot.service.ts` will own mentor synchronization for hive-managed bots.

`updateBotMentor(botId, mentorId)` will follow this flow:

1. Load the current bot record.
2. If the bot is not hive-managed, update `im_bots.mentor_id` only and return.
3. If the bot is hive-managed:
   - require `managedMeta.agentId`
   - resolve `tenantId`
   - build the full metadata object `{ tenantId, botId, mentorId }`
   - call `clawHiveService.updateAgent(agentId, { metadata })`
4. If the hive update succeeds, update `im_bots.mentor_id`.
5. If the Team9 DB write fails after the hive update, attempt a compensating hive update that restores the previous `mentorId`, then throw.

Controllers continue to call `botService.updateBotMentor()` and do not need hive-specific logic.

### 5. Tenant resolution

For hive-managed bots, `tenantId` will be resolved from `im_installed_applications.tenant_id` through `bots.installedApplicationId`.

This is preferred over inferring tenant membership from `tenant_members`, because the installed application relationship is already the stable source of workspace ownership for managed app bots.

If a hive-managed bot cannot resolve both:

- `managedMeta.agentId`
- `installedApplication.tenantId`

then `updateBotMentor()` will fail without changing Team9 state. This is stricter than the current behavior by design, because silent partial updates would break hive filtering.

## Error Handling

### Hive update fails before DB write

- Return an error from `updateBotMentor()`
- Do not update `im_bots.mentor_id`

### DB write fails after hive update

- Attempt a compensating hive update with the old metadata
- Throw an error regardless of compensation outcome
- Log the original failure and any compensation failure

### Missing hive linkage on a supposedly hive-managed bot

If `managedProvider = 'hive'` but Team9 cannot resolve the target agent or tenant, the method fails fast. This exposes broken bot configuration instead of hiding it behind stale hive metadata.

## Data Ownership

Team9 is the source of truth for:

- `mentorId`
- `botId`
- `tenantId`

Hive stores a searchable copy for operational filtering only.

Team9 remains the source of truth for the target hive agent identity via `managedMeta.agentId`.

## Testing Strategy

### ClawHiveService

Add tests for `updateAgent()` covering:

- request method and URL
- auth and tenant headers
- request body containing `metadata`
- non-2xx failure behavior

### BaseModelStaffHandler

Update install tests to assert `registerAgents()` includes:

- `metadata.tenantId`
- `metadata.botId`
- `metadata.mentorId`

### BotService

Add tests for `updateBotMentor()` covering:

- non-hive bot updates DB only
- hive bot updates hive first, then DB
- hive failure aborts the DB update
- DB failure triggers compensating hive rollback
- missing `agentId` rejects
- missing installed-application tenant rejects

### InstalledApplicationsController

Keep controller tests focused on API behavior:

- successful mentor transfer still returns success
- service failure propagates as an error response

## Rollout Notes

- New hive-managed agents created after deployment will contain metadata immediately.
- Existing hive-managed agents will not be backfilled automatically.
- Existing agents can become consistent later if their mentor is updated through the normal Team9 API after this change ships.

## Implementation Notes

- Keep the metadata contract centralized in Team9 code so future hive-managed creation flows can reuse it.
- Avoid putting hive sync logic in controllers.
- Do not widen `managedMeta` to mirror the three hive metadata fields; `managedMeta` remains provider-integration data, with `agentId` as the critical pointer.

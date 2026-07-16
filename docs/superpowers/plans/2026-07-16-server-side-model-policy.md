# Server-Side Model Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Team9's server the mandatory authority for whether a bot may change models and which exact provider/model pair may be persisted or sent to agent-pi.

**Architecture:** A global gateway `ModelPolicyModule` owns the versioned staff catalog, capability derivation, safe validation, durable model-change audit attempts, and an outbox dispatcher. Every user-controlled model path obtains an internal `ApprovedModelRef`; fixed/unknown applications fail closed. The client fetches the catalog for presentation, while all mutation enforcement remains server-side.

**Tech Stack:** NestJS, TypeScript, Drizzle ORM, PostgreSQL, Jest, React, TanStack Query, Axios, Vitest, Socket.IO.

---

## Dependencies and scope

The outbox dispatcher depends on agent-pi's queue `enqueueOnce` contract accepting a caller-supplied idempotency key. Deploy agent-pi generic resolver readiness and idempotent enqueue support before enabling this dispatcher. The Team9 catalog never moves into agent-pi.

This plan covers all current user-controlled model mutation surfaces:

- `PATCH /v1/im/channels/:channelId/model`
- `PATCH /v1/im/bots/:botId/model`
- common-staff create/update
- personal-staff create/update

Credit, registration, IP/device, and rate-limit work remains deferred.

## File map

- Create `apps/server/apps/gateway/src/model-policy/` for catalog, policy, commands, controller, outbox processor, and tests.
- Create `apps/server/libs/database/src/schemas/im/model-change-attempts.ts` and `model-change-outbox.ts`.
- Add migration `apps/server/libs/database/migrations/0066_model_change_attempts.sql` plus Drizzle metadata.
- Modify channel/bot model controllers and channel target resolution.
- Modify common/personal staff services and DTOs.
- Modify `@team9/claw-hive` client for readiness and idempotent model changes.
- Replace the client-only catalog constant with an authenticated query hook and pure presentation helpers.

### Task 1: Build and validate the authoritative server catalog

**Files:**

- Create: `apps/server/apps/gateway/src/model-policy/staff-model-catalog.ts`
- Create: `apps/server/apps/gateway/src/model-policy/model-policy.errors.ts`
- Create: `apps/server/apps/gateway/src/model-policy/model-policy.service.ts`
- Create: `apps/server/apps/gateway/src/model-policy/model-policy.service.spec.ts`

- [ ] **Step 1: Write failing catalog validation tests**

```ts
describe("ModelPolicyService", () => {
  it.each(STAFF_MODELS)("accepts $provider/$id for staff", (entry) => {
    expect(service.assertModelAllowed("staff", entry)).toEqual(entry);
  });

  it.each([
    { provider: "custom", id: "gpt-4" },
    { provider: "anthropic", id: "claude-3-opus" },
    { provider: "http://evil.com", id: "test" },
    { provider: "openrouter", id: "openai/gpt-5.5\n" },
  ])("rejects unsupported or unsafe pair %#", (model) => {
    expect(() => service.assertModelAllowed("staff", model)).toThrow(
      "unsupported_model",
    );
  });

  it("rejects duplicate pairs and two defaults at startup", () => {
    expect(() => validateCatalog([...STAFF_MODELS, STAFF_MODELS[0]])).toThrow();
    expect(() =>
      validateCatalog(STAFF_MODELS.map((m) => ({ ...m, default: true }))),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run and confirm missing policy failures**

Run: `pnpm --filter @team9/gateway test -- --runInBand src/model-policy/model-policy.service.spec.ts`

Expected: FAIL because the model-policy module does not exist.

- [ ] **Step 3: Implement exact catalog and branded approval**

```ts
export type DynamicModelCapability = "staff";

declare const approvedModel: unique symbol;
export type ApprovedModelRef = Readonly<{
  provider: string;
  id: string;
  catalogVersion: string;
  capability: DynamicModelCapability;
  [approvedModel]: true;
}>;

export interface StaffModelCatalogEntry {
  provider: "openrouter";
  id: string;
  displayKey: string;
  label: string;
  family: "anthropic" | "openai" | "google" | "other";
  enabled: boolean;
  capabilities: readonly DynamicModelCapability[];
  minimumResolverCapabilityVersion: string;
  default?: boolean;
}

export const STAFF_MODEL_CATALOG_VERSION = "2026-07-16.1";
```

Populate exactly the twelve approved `openrouter` pairs from the design. `assertDynamicSwitchAllowed()` maps only `common-staff` and `personal-staff` to `staff`; `base-model-staff` throws `model_switch_not_allowed`; unknown IDs fail closed. Trim outer whitespace before exact matching, but do not lowercase or rewrite IDs. Reject URL-like/control-character/overlength values before lookup.

- [ ] **Step 4: Pass tests and typecheck the gateway**

Run: `pnpm --filter @team9/gateway test -- --runInBand src/model-policy/model-policy.service.spec.ts && pnpm --filter @team9/gateway build`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/apps/gateway/src/model-policy
git commit -m "feat(gateway): add authoritative staff model policy"
```

### Task 2: Expose a read-only versioned catalog and verify agent-pi readiness

**Files:**

- Create: `apps/server/apps/gateway/src/model-policy/model-policy.module.ts`
- Create: `apps/server/apps/gateway/src/model-policy/staff-model-catalog.controller.ts`
- Create: `apps/server/apps/gateway/src/model-policy/staff-model-catalog.controller.spec.ts`
- Modify: `apps/server/apps/gateway/src/app.module.ts`
- Modify: `apps/server/libs/claw-hive/src/claw-hive.service.ts`
- Modify: `apps/server/libs/claw-hive/src/claw-hive.service.spec.ts`

- [ ] **Step 1: Write endpoint and readiness tests**

Assert authenticated `GET /v1/models/staff` returns only enabled entries, one default, `catalogVersion`, and an ETag. Assert a disabled entry stays hidden when any eligible agent-pi worker reports a lower resolver capability version. Assert no response contains tenant entitlements or provider credentials.

- [ ] **Step 2: Run and confirm 404/missing-client failures**

Run:

```bash
pnpm --filter @team9/gateway test -- --runInBand src/model-policy/staff-model-catalog.controller.spec.ts
NODE_OPTIONS='--experimental-vm-modules' pnpm -C apps/server exec jest --config libs/claw-hive/jest.config.cjs --runInBand --runTestsByPath libs/claw-hive/src/claw-hive.service.spec.ts
```

Expected: FAIL because the route and readiness client do not exist.

- [ ] **Step 3: Add the generic readiness client**

```ts
export interface HiveWorkerFleetReadiness {
  resolverCapabilityVersion: { minimum: string; versions: Record<string, number> };
  queueProtocolVersion: { minimum: number; incompatibleWorkerIds: string[] };
  readyForQueueV2: boolean;
}

async getWorkerFleetReadiness(): Promise<HiveWorkerFleetReadiness> {
  return this.getJson('/api/workers/readiness');
}
```

The policy service enables a catalog entry only when the fleet minimum satisfies `minimumResolverCapabilityVersion`. A readiness outage fails closed for mutation; the read endpoint may return the last server catalog with `runtimeReady: false` so the UI disables selection.

- [ ] **Step 4: Add the global module and endpoint**

Make `ModelPolicyModule` global so channel, bot, and application services share one policy instance without new circular imports. Export `ModelPolicyService` and later command/outbox services. Protect the endpoint with `AuthGuard`.

- [ ] **Step 5: Pass tests and commit**

Run:

```bash
pnpm --filter @team9/gateway test -- --runInBand src/model-policy/staff-model-catalog.controller.spec.ts
NODE_OPTIONS='--experimental-vm-modules' pnpm -C apps/server exec jest --config libs/claw-hive/jest.config.cjs --runInBand --runTestsByPath libs/claw-hive/src/claw-hive.service.spec.ts
```

```bash
git add apps/server/apps/gateway/src/model-policy apps/server/apps/gateway/src/app.module.ts apps/server/libs/claw-hive/src/claw-hive.service.ts apps/server/libs/claw-hive/src/claw-hive.service.spec.ts
git commit -m "feat(gateway): expose runtime-ready model catalog"
```

### Task 3: Enforce policy in common/personal staff lifecycle services

**Files:**

- Modify: `apps/server/apps/gateway/src/applications/dto/common-staff.dto.ts`
- Modify: `apps/server/apps/gateway/src/applications/dto/personal-staff.dto.ts`
- Modify: `apps/server/apps/gateway/src/applications/common-staff.service.ts`
- Modify: `apps/server/apps/gateway/src/applications/common-staff.service.spec.ts`
- Modify: `apps/server/apps/gateway/src/applications/personal-staff.service.ts`
- Modify: `apps/server/apps/gateway/src/applications/personal-staff.service.spec.ts`

- [ ] **Step 1: Add rejection-before-mutation tests**

For create and update in both services, pass `custom/gpt-4`, `anthropic/claude-3-opus`, and `http://evil.com/test`. Assert the service throws `unsupported_model` before DB insert/update, bot extra mutation, `registerAgent`, or `updateAgent`. Assert omitted update model leaves the existing value unchanged.

- [ ] **Step 2: Run and confirm current DTO strings reach persistence**

Run: `pnpm --filter @team9/gateway test -- --runInBand src/applications/common-staff.service.spec.ts src/applications/personal-staff.service.spec.ts`

Expected: FAIL because both services currently pass `dto.model` through unchanged.

- [ ] **Step 3: Add cheap boundary constraints**

Keep DTO validation as shape only but add `MaxLength(128/256)` and prohibit whitespace-only values. Do not duplicate the allowlist in decorators.

- [ ] **Step 4: Require approval immediately before side effects**

```ts
const approvedModel = await this.modelPolicy.assertRuntimeReadyAndModelAllowed(
  'staff',
  dto.model,
);

await this.staffService.create({
  ...,
  model: approvedModel,
});
```

Perform the same approval on update only when `dto.model !== undefined`. Change internal helper parameter types to `ApprovedModelRef` where they persist model data or call `ClawHiveService`; do not let an arbitrary DTO type cross that boundary.

- [ ] **Step 5: Pass service tests**

Run: `pnpm --filter @team9/gateway test -- --runInBand src/applications/common-staff.service.spec.ts src/applications/personal-staff.service.spec.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/apps/gateway/src/applications/dto/common-staff.dto.ts apps/server/apps/gateway/src/applications/dto/personal-staff.dto.ts apps/server/apps/gateway/src/applications/common-staff.service.ts apps/server/apps/gateway/src/applications/common-staff.service.spec.ts apps/server/apps/gateway/src/applications/personal-staff.service.ts apps/server/apps/gateway/src/applications/personal-staff.service.spec.ts
git commit -m "fix(gateway): enforce model policy in staff lifecycle"
```

### Task 4: Resolve installed application identity and model-management authority

**Files:**

- Modify: `apps/server/apps/gateway/src/im/channels/channels.service.ts`
- Modify: `apps/server/apps/gateway/src/im/channels/channels.service.spec.ts`
- Modify: `apps/server/apps/gateway/src/im/channels/channel-model.controller.ts`
- Modify: `apps/server/apps/gateway/src/im/channels/channel-model.controller.spec.ts`
- Modify: `apps/server/apps/gateway/src/bot/bot-model.controller.ts`
- Modify: `apps/server/apps/gateway/src/bot/bot-model.controller.spec.ts`

- [ ] **Step 1: Write fixed/unknown/read-only target tests**

Cover channel and bot routes:

- `base-model-staff` rejects even an approved staff pair;
- unknown or null installed application linkage returns `model_policy_target_invalid`;
- common/personal staff resolve capability `staff`;
- routine/topic owner/admin may mutate, ordinary member/public reader/tracking reader may not;
- direct channel uses the human owner/participant rule;
- mentor/owner bot route still requires active tenant membership and a switchable application.

- [ ] **Step 2: Run and confirm fixed bots pass current resolution**

Run: `pnpm --filter @team9/gateway test -- --runInBand src/im/channels/channels.service.spec.ts src/im/channels/channel-model.controller.spec.ts src/bot/bot-model.controller.spec.ts`

Expected: FAIL because resolution currently checks read access and Hive metadata only.

- [ ] **Step 3: Join the installed application in one resolver query**

Extend the bot query with `bots.id`, `bots.installedApplicationId`, `installedApplications.applicationId`, tenant, and status. Return:

```ts
interface ModelSwitchTarget {
  tenantId: string | null;
  agentId: string;
  sessionId: string;
  botId: string;
  botUserId: string;
  installedApplicationId: string;
  applicationId: string;
  capability: DynamicModelCapability;
}
```

Require one active Hive bot, non-null consistent installed linkage, and `assertDynamicSwitchAllowed(applicationId)`. Do not fall back from missing application identity to a generic Hive capability.

- [ ] **Step 4: Add `assertModelManageAccess`**

Keep GET/SSE on `assertReadAccess`, but PATCH must call the new mutation rule. For routine/topic/shared channel types use `getEffectiveRole()` and require `owner|admin`; for direct channels require the authorized active human participant under the current ownership model. Return stable `model_manage_forbidden` rather than reusing read success.

- [ ] **Step 5: Pass tests and commit**

Run: `pnpm --filter @team9/gateway test -- --runInBand src/im/channels/channels.service.spec.ts src/im/channels/channel-model.controller.spec.ts src/bot/bot-model.controller.spec.ts`

```bash
git add apps/server/apps/gateway/src/im/channels/channels.service.ts apps/server/apps/gateway/src/im/channels/channels.service.spec.ts apps/server/apps/gateway/src/im/channels/channel-model.controller.ts apps/server/apps/gateway/src/im/channels/channel-model.controller.spec.ts apps/server/apps/gateway/src/bot/bot-model.controller.ts apps/server/apps/gateway/src/bot/bot-model.controller.spec.ts
git commit -m "fix(gateway): reject model changes on fixed bots"
```

### Task 5: Add durable model-change attempt and outbox schemas

**Files:**

- Create: `apps/server/libs/database/src/schemas/im/model-change-attempts.ts`
- Create: `apps/server/libs/database/src/schemas/im/model-change-outbox.ts`
- Modify: `apps/server/libs/database/src/schemas/im/index.ts`
- Create: `apps/server/libs/database/src/schemas/im/model-change-attempts.schema.spec.ts`
- Create: `apps/server/libs/database/migrations/0066_model_change_attempts.sql`
- Modify: `apps/server/libs/database/migrations/meta/_journal.json`
- Create: `apps/server/libs/database/migrations/meta/0066_snapshot.json`

- [ ] **Step 1: Write schema tests**

Assert unique idempotency key, attempt-to-outbox one-to-one relation, safe field lengths, accepted/rejected status constraints, outbox claim/retry indexes, and no arbitrary raw request JSON column.

- [ ] **Step 2: Run and confirm missing exports**

Run: `pnpm --filter @team9/database test -- --runInBand model-change-attempts.schema.spec.ts`

Expected: FAIL because schemas are absent.

- [ ] **Step 3: Define append-only attempt data**

The attempt table must include:

```ts
(id,
  idempotencyKey,
  actorUserId,
  authSessionId,
  correlationId,
  tenantId,
  channelId,
  botId,
  installedApplicationId,
  applicationId,
  sessionId,
  requestedProvider,
  requestedModelId,
  capability,
  catalogVersion,
  decision,
  reasonCode,
  dispatchStatus,
  safeErrorCode,
  createdAt,
  updatedAt,
  dispatchedAt);
```

Context columns are nullable for early rejections. `decision` is `accepted|rejected`; dispatch status is `not_applicable|pending|dispatching|dispatched|failed`. The outbox has `attemptId` unique/FK, `status`, `retryCount`, `nextAttemptAt`, `claimToken`, `claimUntil`, timestamps, and sanitized error code. Store only normalized bounded provider/id, never raw bodies/tokens/cookies.

- [ ] **Step 4: Generate and inspect the migration**

Run: `pnpm --filter @team9/database db:generate`

Inspect the SQL. If Drizzle emits historical drift, keep the generated `0066_snapshot.json`, replace only the SQL with the hand-written two-table/enums/indexes migration, and rename the journal tag to `0066_model_change_attempts` as required by `migrations/README.md`.

- [ ] **Step 5: Prove the snapshot is clean**

Run: `pnpm --filter @team9/database db:generate && pnpm check:migrations`

Expected: `No schema changes, nothing to migrate`, then migration-order check passes.

- [ ] **Step 6: Pass schema tests and commit**

```bash
pnpm --filter @team9/database test -- --runInBand model-change-attempts.schema.spec.ts
git add apps/server/libs/database/src/schemas/im/model-change-attempts.ts apps/server/libs/database/src/schemas/im/model-change-outbox.ts apps/server/libs/database/src/schemas/im/index.ts apps/server/libs/database/src/schemas/im/model-change-attempts.schema.spec.ts apps/server/libs/database/migrations/0066_model_change_attempts.sql apps/server/libs/database/migrations/meta/_journal.json apps/server/libs/database/migrations/meta/0066_snapshot.json
git commit -m "feat(database): add model change audit outbox"
```

### Task 6: Create the fail-closed model-change command service

**Files:**

- Create: `apps/server/apps/gateway/src/model-policy/model-change-command.service.ts`
- Create: `apps/server/apps/gateway/src/model-policy/model-change-command.service.spec.ts`
- Modify: `apps/server/apps/gateway/src/model-policy/model-policy.module.ts`

- [ ] **Step 1: Write accepted, rejected, idempotent, and audit-outage tests**

Assert:

- a rejection is persisted before its 4xx is thrown;
- an accepted attempt and outbox row are inserted in one transaction;
- the same actor/idempotency key returns the same attempt without another row;
- key reuse with different normalized input returns 409;
- DB failure returns 503 and never dispatches;
- accepted records contain only `ApprovedModelRef` values.

- [ ] **Step 2: Run and confirm missing service**

Run: `pnpm --filter @team9/gateway test -- --runInBand src/model-policy/model-change-command.service.spec.ts`

Expected: FAIL because the command service does not exist.

- [ ] **Step 3: Implement `requestChannelModelChange` and `requestBotModelChange`**

```ts
type ModelChangeRequestResult =
  | { state: "pending"; attemptId: string }
  | { state: "dispatched"; attemptId: string; model: ApprovedModelRef };
```

Resolve actor authority/target and policy inside the command service, not in the controller. On a known policy/access/target rejection, call `recordRejectedOrThrowUnavailable()` before rethrowing the stable HTTP error. On acceptance, transactionally insert attempt+outbox. If the attempt insert fails, throw `ServiceUnavailableException('model_change_audit_unavailable')` and perform no Hive call.

- [ ] **Step 4: Handle malformed DTO rejections**

Add a model-route exception interceptor in this module that records `invalid_model_ref` for validation-pipe failures using only bounded primitive fields available from the request. Deduplicate it with the request idempotency/correlation key. If that audit insert fails, replace the 400 with 503 to preserve fail-closed behavior.

- [ ] **Step 5: Pass tests and commit**

Run: `pnpm --filter @team9/gateway test -- --runInBand src/model-policy/model-change-command.service.spec.ts`

```bash
git add apps/server/apps/gateway/src/model-policy
git commit -m "feat(gateway): persist model decisions before dispatch"
```

### Task 7: Dispatch the outbox idempotently and expose status

**Files:**

- Create: `apps/server/apps/gateway/src/model-policy/model-change-outbox.processor.ts`
- Create: `apps/server/apps/gateway/src/model-policy/model-change-outbox.processor.spec.ts`
- Create: `apps/server/apps/gateway/src/model-policy/model-change-attempt.controller.ts`
- Create: `apps/server/apps/gateway/src/model-policy/model-change-attempt.controller.spec.ts`
- Modify: `apps/server/apps/gateway/src/model-policy/model-policy.module.ts`
- Modify: `apps/server/libs/claw-hive/src/claw-hive.service.ts`
- Modify: `apps/server/libs/claw-hive/src/claw-hive.service.spec.ts`

- [ ] **Step 1: Write crash/idempotency tests**

Cover two processors claiming concurrently, crash before Hive, lost HTTP response after Hive enqueue, restart with a pending row, terminal failure, and duplicate websocket publication. Assert the stable attempt ID is the Hive queue message ID/idempotency key every time.

- [ ] **Step 2: Run and confirm failures**

Run:

```bash
pnpm --filter @team9/gateway test -- --runInBand src/model-policy/model-change-outbox.processor.spec.ts
NODE_OPTIONS='--experimental-vm-modules' pnpm -C apps/server exec jest --config libs/claw-hive/jest.config.cjs --runInBand --runTestsByPath libs/claw-hive/src/claw-hive.service.spec.ts
```

Expected: FAIL because dispatch is currently a direct, non-idempotent call.

- [ ] **Step 3: Extend the agent-pi client contract**

```ts
async changeSessionModel(
  sessionId: string,
  model: ApprovedModelRef,
  options: { tenantId?: string; idempotencyKey: string },
): Promise<{ messageId: string }> {
  return this.sendInput(sessionId, event, options.tenantId, 30_000, options.idempotencyKey);
}
```

Send `{ event, idempotencyKey }` to agent-pi. Treat an agent-pi response returning the same message ID as success; never mint a new ID during retry.

- [ ] **Step 4: Implement claim-token processing**

Every interval, claim a small due batch with PostgreSQL `FOR UPDATE SKIP LOCKED`, set unique `claimToken/claimUntil`, then work outside the transaction. Final status updates compare the token. Retry temporary failures with bounded backoff; mark stable policy/protocol failures terminal. Use `OnModuleInit`/`OnModuleDestroy` and an unref'd timer, matching existing gateway lifecycle style.

On confirmed dispatch, update attempt/outbox and publish `MODEL_CHANGED` exactly once using `attemptId` as event identity. A repair scan handles dispatched rows missing publication.

- [ ] **Step 5: Add status API**

Authenticated `GET /v1/model-changes/:attemptId` returns only attempts visible to the actor/tenant and the states `pending|dispatched|failed|rejected`, with safe reason/error codes.

- [ ] **Step 6: Pass tests and commit**

Run:

```bash
pnpm --filter @team9/gateway test -- --runInBand src/model-policy/model-change-outbox.processor.spec.ts src/model-policy/model-change-attempt.controller.spec.ts
NODE_OPTIONS='--experimental-vm-modules' pnpm -C apps/server exec jest --config libs/claw-hive/jest.config.cjs --runInBand --runTestsByPath libs/claw-hive/src/claw-hive.service.spec.ts
```

```bash
git add apps/server/apps/gateway/src/model-policy apps/server/libs/claw-hive/src/claw-hive.service.ts apps/server/libs/claw-hive/src/claw-hive.service.spec.ts
git commit -m "feat(gateway): dispatch model changes from durable outbox"
```

### Task 8: Route channel and bot mutations through the command service

**Files:**

- Modify: `apps/server/apps/gateway/src/im/channels/channel-model.controller.ts`
- Modify: `apps/server/apps/gateway/src/im/channels/channel-model.controller.spec.ts`
- Modify: `apps/server/apps/gateway/src/bot/bot-model.controller.ts`
- Modify: `apps/server/apps/gateway/src/bot/bot-model.controller.spec.ts`

- [ ] **Step 1: Add HTTP behavior tests**

Assert synchronous confirmed dispatch returns 200, durable pending returns 202 `{attemptId,statusUrl}`, same idempotency key returns the same attempt, rejected requests never call Hive or emit websocket success, and websocket publication occurs only after processor-confirmed dispatch.

- [ ] **Step 2: Run and confirm direct-dispatch failures**

Run: `pnpm --filter @team9/gateway test -- --runInBand src/im/channels/channel-model.controller.spec.ts src/bot/bot-model.controller.spec.ts`

Expected: FAIL because controllers currently call `ClawHiveService` and mutate local state directly.

- [ ] **Step 3: Add idempotency input and stable errors**

Read `Idempotency-Key` with a bounded generated request fallback returned to the caller. Route both controllers through the command service. Map errors exactly:

- 400 `invalid_model_ref|unsupported_model`
- 403 `model_switch_not_allowed|model_manage_forbidden`
- 409 `model_policy_target_invalid|idempotency_conflict`
- 503 `model_change_audit_unavailable|model_change_unavailable`

Do not echo unsanitized attacker strings.

- [ ] **Step 4: Remove controller-owned success fanout**

Delete direct `changeSessionModel()` and `sendToChannelMembers()` from channel controller. The outbox processor becomes the sole producer of `MODEL_CHANGED`. For bot-default changes, processor updates agent-pi first and then the local `bots.extra` snapshot idempotently.

- [ ] **Step 5: Pass tests and commit**

Run: `pnpm --filter @team9/gateway test -- --runInBand src/im/channels/channel-model.controller.spec.ts src/bot/bot-model.controller.spec.ts`

```bash
git add apps/server/apps/gateway/src/im/channels/channel-model.controller.ts apps/server/apps/gateway/src/im/channels/channel-model.controller.spec.ts apps/server/apps/gateway/src/bot/bot-model.controller.ts apps/server/apps/gateway/src/bot/bot-model.controller.spec.ts
git commit -m "fix(gateway): make model mutation durable and auditable"
```

### Task 9: Replace the client-only catalog with the server response

**Files:**

- Modify: `apps/client/src/services/api/applications.ts`
- Modify: `apps/client/src/services/api/im.ts`
- Create: `apps/client/src/hooks/useStaffModelCatalog.ts`
- Create: `apps/client/src/hooks/__tests__/useStaffModelCatalog.test.tsx`
- Modify: `apps/client/src/lib/common-staff-models.ts`
- Modify: `apps/client/src/lib/common-staff-models.test.ts`
- Modify: `apps/client/src/hooks/useBotModelSwitch.ts`
- Modify: `apps/client/src/hooks/useChannelModel.ts`
- Modify: `apps/client/src/components/ai-staff/CommonStaffDetailSection.tsx`
- Modify: `apps/client/src/components/ai-staff/CreateCommonStaffDialog.tsx`
- Modify: `apps/client/src/components/ai-staff/PersonalStaffDetailSection.tsx`
- Modify: `apps/client/src/components/channel/ChannelView.tsx`
- Modify: `apps/client/src/components/channel/editor/RichTextEditor.tsx`
- Modify: `apps/client/src/components/layout/contents/HomeMainContent.tsx`

- [ ] **Step 1: Write catalog-query and pending-attempt tests**

Assert the hook caches by catalog version/ETag, exposes enabled/default models, disables mutation when `runtimeReady=false`, refetches after `unsupported_model`, and polls a 202 attempt until dispatched/failed. No test may rely on a permissive local fallback list.

- [ ] **Step 2: Run and confirm the static constant is still required**

Run: `pnpm --filter @team9/client test -- src/hooks/__tests__/useStaffModelCatalog.test.tsx src/lib/common-staff-models.test.ts`

Expected: FAIL because the hook/API do not exist.

- [ ] **Step 3: Keep only pure presentation helpers locally**

`common-staff-models.ts` retains `StaffModel`, family types, label formatting, and pure helpers:

```ts
export function getDefaultStaffModel(models: StaffModel[]): StaffModel {
  const value = models.find((model) => model.default);
  if (!value) throw new Error("Server catalog has no default model");
  return value;
}
```

Remove `COMMON_STAFF_MODELS` and `DEFAULT_STAFF_MODEL`. Each consumer gets models/default from `useStaffModelCatalog()` or receives them as props. Loading/error state disables selectors; it never invents an allowed model.

- [ ] **Step 4: Support 200/202 mutation results**

Update API types and hooks so 200 updates cache immediately, while 202 stores/polls `attemptId` and only presents success after the status reaches `dispatched`. `unsupported_model` invalidates the catalog before surfacing the error.

- [ ] **Step 5: Pass client tests and typecheck**

Run:

```bash
pnpm --filter @team9/client test -- src/hooks/__tests__/useStaffModelCatalog.test.tsx src/lib/common-staff-models.test.ts src/hooks/__tests__/useChannelModel.test.tsx
pnpm --filter @team9/client typecheck
```

Expected: PASS.

- [ ] **Step 6: Prove the static allowlist is gone and commit**

Run: `rg -n "COMMON_STAFF_MODELS|DEFAULT_STAFF_MODEL" apps/client apps/server`

Expected: no matches.

```bash
git add apps/client/src
git commit -m "feat(client): consume server model catalog"
```

### Task 10: Add full incident regression, rollout checks, and verification

**Files:**

- Create: `apps/server/apps/gateway/src/model-policy/model-policy-incident.spec.ts`
- Create: `docs/runbooks/2026-07-16-model-policy-incident.md`
- Modify: `apps/server/apps/gateway/src/model-policy/model-change-outbox.processor.ts`
- Modify: `apps/server/apps/gateway/src/model-policy/model-policy.service.ts`

- [ ] **Step 1: Add the exact fixed-bot regression**

Against a channel/bot linked to `base-model-staff`/`base-model-chatgpt`, submit:

```ts
[
  { provider: "custom", id: "gpt-4" },
  { provider: "anthropic", id: "claude-3-opus" },
  { provider: "http://evil.com", id: "test" },
  { provider: "openrouter", id: "openai/gpt-5.5" },
];
```

Every request must return `model_switch_not_allowed`; each rejection has one sanitized durable attempt; there is no outbox row, Hive call, local model mutation, or websocket success event. Against common/personal staff, malicious pairs return `unsupported_model` and one catalog pair succeeds.

- [ ] **Step 2: Run and confirm final integration wiring**

Run: `pnpm --filter @team9/gateway test -- --runInBand src/model-policy/model-policy-incident.spec.ts`

Expected: PASS after Tasks 1–9.

- [ ] **Step 3: Add security metrics without high-cardinality payloads**

Count decisions by reason/application/provider, fixed-bot rejections, unsupported pairs, audit failures, dispatch failures, retry age, and catalog/runtime readiness. Include attempt/correlation IDs in logs, never raw body/JWT/cookie/prompt/provider credentials.

- [ ] **Step 4: Write rollout and containment runbook**

Include: verify agent-pi generic resolver readiness first; apply migration; deploy server enforcement before client; enable outbox only after agent-pi idempotency; disable Team9 entries before later runtime removal. Record incident evidence/account/session containment separately, including that network-source attribution is unavailable. Explicitly mark credit/registration abuse as deferred.

- [ ] **Step 5: Run repository verification**

```bash
pnpm check:migrations
pnpm --filter @team9/database test
pnpm --filter @team9/gateway test -- --runInBand
pnpm --filter @team9/client test
pnpm build:server
pnpm --filter @team9/client typecheck
pnpm lint:ci
```

Expected: all checks pass. Do not weaken unrelated access, migration, or client tests to obtain green.

- [ ] **Step 6: Commit**

```bash
git add apps/server/apps/gateway/src/model-policy docs/runbooks/2026-07-16-model-policy-incident.md
git commit -m "test(security): lock fixed bots to server policy"
```

## Deployment checklist

- [ ] Agent-pi fleet advertises the required generic resolver and queue protocol versions.
- [ ] Migration `0066_model_change_attempts.sql` is applied and indexes verified.
- [ ] Server catalog/policy ships with outbox disabled; all mutation routes reject arbitrary pairs immediately.
- [ ] Staff create/update and both PATCH routes are verified in production logs.
- [ ] Enable outbox only after stable idempotency keys are accepted by agent-pi.
- [ ] Ship the server-catalog client after server enforcement is live.
- [ ] Monitor rejected legitimate IDs before deleting the old client constant.
- [ ] To remove a model, disable Team9 catalog selection first and remove runtime resolution last.

## Acceptance verification

- [ ] Fixed base-model bots reject all dynamic model changes, including catalog-valid pairs.
- [ ] Every current user/API model path obtains an `ApprovedModelRef` before mutation.
- [ ] Accepted and rejected decisions are durable before dispatch/response.
- [ ] One idempotency key can create at most one Hive queue message.
- [ ] Websocket success appears only after confirmed dispatch.
- [ ] Client catalog data comes from the authenticated server endpoint.
- [ ] agent-pi contains no Team9 allowlist or application-policy data.

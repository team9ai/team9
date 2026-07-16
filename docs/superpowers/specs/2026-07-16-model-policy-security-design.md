# Server-Side Model Policy and Incident Response Design

**Status:** Approved design, implementation pending

**Date:** 2026-07-16

**Scope:** Team9 gateway model mutation paths, shared model catalog, audit logging, incident containment

## Summary

Team9 currently validates channel model updates only as non-empty strings before enqueueing `session.model_override` to agent-pi. The frontend hides model switching for fixed base-model bots, but the server endpoint does not enforce that product capability. An authenticated user therefore called the endpoint directly for `base-model-chatgpt` and submitted arbitrary model references. Those inputs triggered a separate infinite-retry bug in agent-pi.

This design makes Team9 the authoritative policy boundary. The server must answer two independent questions before any user-selected model reaches agent-pi:

1. Is this application/bot/session allowed to choose a model dynamically?
2. Is the exact provider/model pair in Team9's current supported catalog for that capability?

Only `common-staff` and `personal-staff` are dynamically switchable in the current product. `base-model-staff` bots use fixed server-owned presets and reject channel-level changes. The same catalog validation is applied to staff create/update flows so the channel endpoint is not the only protected path.

agent-pi remains product-agnostic and must not contain Team9's allowlist.

## Confirmed Vulnerability

The affected route is:

`PATCH /v1/im/channels/:channelId/model`

Current behavior:

- `ModelRefDto` checks only type and length.
- `resolveModelSwitchTarget` checks channel type, read access, and the presence of exactly one Hive-managed bot.
- It does not resolve or enforce the bot's installed application type.
- The controller calls `ClawHiveService.changeSessionModel`, which enqueues the supplied provider/id unchanged.
- The frontend's `useBotModelSwitch` correctly exposes switching only for `common-staff` and `personal-staff`, but UI visibility is not an authorization boundary.

The incident target was the fixed `base-model-chatgpt` agent. Direct API use therefore bypassed both the UI capability restriction and the intended model catalog.

Known malicious references included:

- `custom/gpt-4`
- `anthropic/claude-3-opus`
- `http://evil.com/test`

The account was a normally authenticated Team9 account funded by the automatic 4,000-credit welcome grant. Credit/registration abuse controls are intentionally deferred from this change; the approved priority is closing the model-policy and retry-loop root causes.

## Goals

1. Enforce dynamic-switch capability in Team9 server code, independent of the client.
2. Require mutation authority rather than treating read access as permission to change a shared session.
3. Enforce an exact server-authoritative provider/model catalog on every user-controlled staff model mutation.
4. Fail closed when application identity or policy cannot be resolved.
5. Prevent model-policy drift between channel switching and staff create/update paths.
6. Give the client a supported catalog without making the client the security authority.
7. Produce useful accepted/rejected audit events without logging secrets.
8. Preserve agent-pi as a generic execution service.

## Non-Goals

- Adding Team9 model policy to agent-pi.
- Registration, payment, credit, IP, device, or rate-limit changes in this phase.
- Allowing arbitrary bring-your-own-provider models.
- Dynamically switching fixed `base-model-staff` agents.
- Using upstream provider availability as the sole authorization decision.

## Policy Model

Introduce a server-owned `ModelPolicyService` with two explicit operations:

```ts
assertDynamicSwitchAllowed(target): DynamicModelCapability
assertModelAllowed(capability, model): ApprovedModelRef
```

`ApprovedModelRef` is a branded/internal type created only after exact policy validation. User-controlled service methods that enqueue or persist a staff model accept this approved type rather than an arbitrary `{ provider, id }` where practical.

The checks are intentionally separate. A valid catalog model is still forbidden for a fixed bot, and a switchable bot still cannot select an arbitrary model.

### Dynamic-switch capability

Current capability matrix:

| Application | Create/update model | Channel dynamic switch | Policy |
|---|---:|---:|---|
| `common-staff` | Yes | Yes | Staff catalog |
| `personal-staff` | Yes | Yes | Staff catalog |
| `base-model-staff` | No user choice | No | Fixed code-owned preset |
| Other/unknown Hive bot | No by default | No | Fail closed |

If future applications need different catalogs, the capability value becomes a named catalog key rather than a boolean. Unknown application IDs have no capability until explicitly registered.

### Exact model identity

Normalize only harmless representation details such as surrounding whitespace before validation. Do not lowercase or rewrite provider/model IDs unless the upstream identifier contract guarantees case insensitivity. Validation requires an exact `(provider, id)` pair.

Reject:

- unknown provider;
- known provider with unknown model ID;
- URL-like or control-character values;
- oversized values;
- aliases not explicitly registered;
- catalog entries disabled for the current capability.

DTO length/shape validation remains as a cheap boundary check, but it is not policy validation.

## Authoritative Staff Catalog

Move the current client-only `COMMON_STAFF_MODELS` data into a shared domain catalog whose server usage is mandatory. The initial allowed pairs are the current product list, all under provider `openrouter`:

- `anthropic/claude-opus-4.7`
- `anthropic/claude-sonnet-4.6`
- `openai/gpt-5.5`
- `openai/gpt-5.4`
- `openai/gpt-5.4-mini`
- `google/gemini-3.5-flash`
- `google/gemini-3.1-pro-preview`
- `google/gemini-3-flash-preview`
- `deepseek/deepseek-v4-pro`
- `qwen/qwen3.6-plus`
- `z-ai/glm-5.1`
- `moonshotai/kimi-k2.6`

The catalog entry includes:

- provider and model ID;
- stable display key/label metadata;
- family/grouping metadata for UI;
- enabled state;
- permitted capability keys;
- minimum generic agent-pi resolver capability version;
- default marker, with exactly one default per capability.

Server startup validates uniqueness, default cardinality, length bounds, and prohibited characters. Invalid catalog configuration prevents startup rather than silently opening policy.

The browser may consume the same shared package or an authenticated read-only catalog endpoint such as `GET /v1/models/staff`. In either case, the server repeats policy validation for every mutation. A stale client receives a clear `unsupported_model` response and refreshes the catalog.

## Channel Model-Switch Flow

Update `resolveModelSwitchTarget` or introduce a dedicated resolver that joins the bot to its installed application and returns:

- tenant ID;
- agent/session IDs;
- bot ID;
- installed application ID;
- derived dynamic-model capability.

Replace the current read-only authorization check with an explicit model-management permission. For direct user/bot channels, the authorized human owner/participant under the existing bot ownership model may manage a switchable staff bot. For routine/topic/shared channels, require the effective channel role defined for mutations (initially `owner` or `admin`). A public/tracking reader or ordinary shared-channel member cannot mutate the model merely because they can read the stream.

The mutation flow becomes:

1. Authenticate the actor.
2. Resolve the channel and enforce model-management authority, not only read access.
3. Resolve exactly one Hive-managed bot and its installed application identity.
4. Call `assertDynamicSwitchAllowed`.
5. Call `assertModelAllowed` for the returned capability.
6. In one database transaction, create an append-only model-change attempt and idempotent outbox row containing only the resulting `ApprovedModelRef`, actor/target context, catalog version, request idempotency key, and policy decision.
7. The outbox dispatcher sends the model override to agent-pi using the attempt ID as the stable Hive input idempotency key, then records `dispatched` or a terminal failure.
8. Emit the websocket `MODEL_CHANGED` event idempotently only after dispatch is confirmed.

For `base-model-staff`, step 4 rejects the request even when the requested pair appears in the staff catalog. GET may still report the effective fixed model, but PATCH is forbidden.

Missing bot/application linkage, multiple bots, unknown applications, and inconsistent managed metadata all fail closed. None falls back to a generic Hive capability.

## Other Model Mutation Paths

Apply the same policy service before persistence or agent registration in:

- common-staff creation;
- common-staff update when `model` is present;
- personal-staff creation;
- personal-staff update when `model` is present;
- any internal gateway method that accepts a model originating from a user/API DTO;
- future import/clone endpoints that carry staff model configuration.

Fixed base-model presets are code-owned, not user-controlled. Validate them separately at startup against the runtime configuration they require, but do not add them to the dynamic staff capability merely to share a type.

Controller decorators alone are insufficient because services can be called from jobs, internal controllers, or tests. The policy check belongs in the service/domain path immediately before model persistence or dispatch.

## API Behavior

Recommended stable errors:

| Condition | HTTP status | Error code |
|---|---:|---|
| Malformed model object | 400 | `invalid_model_ref` |
| Well-formed but unsupported pair | 400 | `unsupported_model` |
| Bot/application cannot switch dynamically | 403 | `model_switch_not_allowed` |
| User lacks channel/application access | 403 | existing access code |
| Reader lacks model-management authority | 403 | `model_manage_forbidden` |
| Persisted bot/application linkage inconsistent | 409 | `model_policy_target_invalid` |
| Unexpected resolver/storage failure | 500 | `model_policy_internal_error` |
| agent-pi dispatch unavailable | existing 5xx mapping | `model_change_unavailable` |

Responses must not echo arbitrary attacker strings without JSON-safe escaping and length limits.

The catalog response has an explicit schema/version or ETag so clients can refresh after an `unsupported_model` rejection.

A dispatch confirmed during the request retains the current 200 response. If policy is accepted and the durable outbox is pending, return 202 with `attemptId` and a status URL rather than reporting failure while a later dispatch may still occur. Repeating the request with the same idempotency key returns the same attempt/status.

## Audit and Security Telemetry

Record both accepted and rejected attempts with:

- timestamp;
- actor user ID;
- tenant ID;
- channel ID, bot ID, application ID, and session ID when resolved;
- requested provider/model after safe normalization;
- policy capability;
- decision and stable reason code;
- request correlation ID and authentication session ID, if available.

The audit record is the model-change attempt itself, not a best-effort log after enqueue. Rejected decisions are inserted before their 4xx response. Accepted decisions and outbox work are inserted atomically before dispatch. Dispatch result and websocket publication are append-only/status transitions tied to the same attempt ID. If the attempt/audit transaction is unavailable, mutation fails closed with 503 and nothing is sent to agent-pi. Sanitization happens before insertion; an unsafe raw request body is never used as a fallback audit payload.

Do not log JWTs, cookies, prompts, provider credentials, or arbitrary request bodies.

Metrics:

- model-change attempts by decision, application, provider, and reason;
- rejected fixed-bot switch attempts;
- unsupported-model attempts;
- accepted dispatch failures;
- catalog-version adoption by clients where observable.

Alert on repeated rejected mutations by one account/session or URL-like model IDs. This is detection only; registration/credit throttling remains deferred.

## Runtime Compatibility Contract

Team9's catalog remains the product allowlist; agent-pi exposes only an authenticated generic resolver capability/build version. Deployment automation verifies every eligible worker is at or above a catalog entry's minimum resolver version before Team9 can enable that entry.

Changes follow an expand/contract order:

1. Add/verify generic runtime resolution across the agent-pi fleet.
2. Enable the Team9 catalog entry.
3. To remove support, disable the Team9 entry and wait until clients/queued mutations can no longer select it.
4. Remove the generic runtime capability from agent-pi last.

Failure of the readiness check keeps the Team9 entry disabled. The generic signal must not expose Team9 tenant entitlements, pricing, bot types, or allowlist decisions.

## Immediate Account and Session Containment

For the confirmed incident:

1. Export immutable evidence for user, authentication sessions, channels, messages, model-change requests, credit ledger, Hive queue entries, and target Taskcast task.
2. Disable user `019e267a-b2d8-758e-b3a2-9bfc607a60d3` (`dzmss` / `Dzmss`) and revoke all active login/refresh sessions.
3. Record the account's automatic welcome grant, consumption ledger, and remaining balance; do not mutate ledger history.
4. Revoke the target Hive session owner, advance its revocation generation, and keep reassignment disabled.
5. Deploy the disabled agent-pi quarantine tooling while the owner remains revoked, then quarantine the five poisoned override messages by ID.
6. Enable resilient consumers only after quarantine verification.
7. Cancel Taskcast task `01KRK8Y78MA3SV416YNAV3E3KJ` with a security incident reason after archive export.
8. Preserve artifact hashes and an operator audit trail for every mutation.

Because historical request logs containing source IP have expired, the account attribution is confirmed while network-source attribution remains unavailable. The response must not claim an IP-level identity that the evidence does not support.

## Defense Boundaries

The full protection is layered:

1. **Team9 authentication and resource authorization** — who may access the channel/application.
2. **Team9 capability policy** — which bot/application may choose a model.
3. **Team9 model catalog** — which exact model may be selected.
4. **agent-pi generic validation and DLQ** — impossible messages cannot poison infrastructure.
5. **Taskcast hot/cold retention** — historical event growth is durably released from Redis.

Layer 4 is not a substitute for layers 2–3. It contains future producer bugs or compromised internal callers without importing Team9 product knowledge.

## Compatibility and Rollout

1. Verify the current agent-pi fleet advertises the generic resolver capability required by every initially enabled catalog entry.
2. Add the shared/server catalog, policy, model-change attempt/outbox schema, and tests without changing the client.
3. Enforce policy in common/personal staff create/update flows.
4. Add application identity to the channel switch resolver and reject fixed/unknown bots.
5. Enforce exact model validation and durable attempt/outbox creation before dispatch.
6. Ship the catalog-backed client or catalog endpoint, including 202 attempt handling.
7. Keep the incident session revoked, deploy agent-pi poison-message/quarantine tooling, then quarantine and verify before release.
8. Review audit metrics for legitimate clients using IDs absent from the catalog.
9. Remove the old client-only catalog after all consumers migrate.

Server enforcement must deploy before or at the same time as any client catalog change. No rolling-deployment stage may temporarily accept arbitrary model IDs.

## Test Strategy

### Model policy unit tests

- Every current catalog pair is accepted for staff capability.
- Unknown provider, unknown ID, provider/ID mismatch, URL, whitespace-only, control characters, and overlength values are rejected.
- Unknown capability/application fails closed.
- Exactly one default exists.
- Duplicate pairs or invalid catalog configuration fail startup validation.

### Channel endpoint tests

- Common-staff and personal-staff can switch to allowed models.
- `base-model-staff` rejects PATCH even for an otherwise allowed staff model.
- Unknown application rejects PATCH.
- Direct API calls cannot bypass UI eligibility.
- Rejected requests never call `changeSessionModel` and never emit `MODEL_CHANGED`.
- Accepted requests emit only after dispatch succeeds.
- Accepted attempt/outbox creation survives a crash before dispatch without losing audit evidence or double-enqueueing.
- Rejected, dispatch-failed, pending, and dispatched attempts record sanitized terminal status; audit storage failure fails closed.
- Existing read-access and multi-bot restrictions remain enforced.
- A read-only shared-channel member cannot change the model; owner/admin policy is honored through effective membership.

### Staff lifecycle tests

- Create/update accepts every supported pair.
- Create/update rejects arbitrary provider/ID before database mutation or agent-pi dispatch.
- Omitted update model leaves the existing model unchanged.
- Internal service calls cannot bypass policy merely by skipping controller validation.

### Incident regression

Against a `base-model-chatgpt` channel, replay all five malicious model references and one currently allowed staff model. Every request is rejected as `model_switch_not_allowed`, no Hive input is created, and no websocket success event is emitted.

Against a switchable staff channel, replay the malicious references. They are rejected as `unsupported_model`; a catalog entry succeeds.

### Contract tests

- Client/shared catalog serialization matches server validation.
- Error codes remain stable.
- The approved reference passed to `ClawHiveService` is byte-for-byte the catalog pair.
- Resolver capability expansion precedes Team9 enablement, while Team9 disablement precedes runtime removal.

## Acceptance Criteria

- Team9 server rejects dynamic model changes for all fixed base-model bots.
- Every user-controlled staff model path uses one authoritative server policy.
- Arbitrary provider/model strings cannot be persisted or sent to agent-pi.
- The client can render the supported catalog without becoming the enforcement boundary.
- Accepted and rejected attempts are durably auditable before dispatch/response, and rejected attempts do not produce success events.
- agent-pi contains no Team9 model catalog or application-policy dependency.
- Credit/registration abuse work remains explicitly deferred rather than being implicitly mixed into this change.

# Model-policy incident rollout and containment

This runbook deploys the server-side staff-model policy and durable model-change
outbox introduced after the fixed-bot model-switch incident. It deliberately
keeps account/credit abuse containment separate from model-policy enforcement.

## Safety invariants

- `base-model-staff` bots, including `base-model-chatgpt-*` agents, never accept
  a dynamic model mutation.
- `common-staff` and `personal-staff` accept only an enabled pair from the
  authenticated Team9 catalog.
- A decision is durable before the request can dispatch to agent-pi.
- The outbox uses the attempt ID as agent-pi's stable `messageId`; retries do not
  create a second logical input.
- Websocket success is published only after confirmed dispatch.
- Logs may contain bounded attempt/correlation IDs and stable error codes. They
  must never contain request bodies, prompts, JWTs, cookies, or provider
  credentials.

## Pre-deployment checks

1. Deploy the agent-pi/hive build that accepts caller-provided `messageId` and
   deduplicates it atomically.
2. Verify the deployed agent-pi source/release contains every enabled Team9
   `openrouter` pair in its local registry, then run one idempotency smoke:
   submit the same harmless model-change input twice with the same
   caller-provided `messageId` and confirm both responses return that ID while
   only one logical queue entry exists.
3. Do not query `/api/workers/readiness`: the current agent-pi API does not
   expose that endpoint, and Team9 owns the product allowlist.
4. Keep `MODEL_CHANGE_OUTBOX_ENABLED=false`. Server policy enforcement and
   durable audit still work with dispatch disabled.

## Database migration

Apply migrations `0066_model_change_attempts.sql` and
`0067_model_change_publication.sql` before deploying the gateway.

Verify tables and indexes:

```sql
SELECT to_regclass('public.im_model_change_attempts') AS attempts,
       to_regclass('public.im_model_change_outbox') AS outbox;

SELECT indexname
FROM pg_indexes
WHERE tablename IN ('im_model_change_attempts', 'im_model_change_outbox')
ORDER BY indexname;
```

The result must include:

- `uq_model_change_attempts_idempotency`
- `idx_model_change_attempts_actor_created`
- `idx_model_change_attempts_tenant_created`
- `idx_model_change_attempts_decision_reason`
- `uq_model_change_outbox_attempt`
- `idx_model_change_outbox_due`
- `idx_model_change_outbox_claim`
- `idx_model_change_outbox_publication`

Do not enable the outbox if either migration or any required index is missing.

## Rollout order

1. Agent-pi registry and idempotent-`messageId` smoke first.
2. Database migrations.
3. Gateway with server catalog, fixed-bot rejection, durable command path, and
   `MODEL_CHANGE_OUTBOX_ENABLED=false`.
4. Verify the authenticated `GET /api/v1/models/staff` response. It must report
   `runtimeReady=true`, one default model, and no entitlement or credential
   data.
5. Exercise both model mutation endpoints:
   - fixed bot: `403 model_switch_not_allowed`
   - unsupported dynamic pair: `400 unsupported_model`
   - catalog-valid staff pair: durable `202` with `attemptId`

6. Set `MODEL_CHANGE_OUTBOX_ENABLED=true` only after the deployed agent-pi
   release passes the message-id/idempotency and enabled-model smoke.
7. Verify the valid attempt reaches `dispatched`, the agent-pi input uses the
   same attempt ID, and at most one `channel_model_changed` event is published.
8. Deploy the client that consumes the authenticated server catalog.

## Monitoring

Watch these OpenTelemetry instruments:

- `model_change.decisions_total`
- `model_change.fixed_bot_rejections_total`
- `model_change.unsupported_total`
- `model_change.audit_failures_total`
- `model_change.dispatch_failures_total`
- `model_change.retry_age_ms`
- `model_catalog.readiness_total`

Metric attributes are bounded buckets only. Attempt and correlation IDs belong
in logs, not metric labels.

Operational database checks:

```sql
SELECT decision, reason_code, dispatch_status, count(*)
FROM im_model_change_attempts
WHERE created_at >= now() - interval '30 minutes'
GROUP BY decision, reason_code, dispatch_status
ORDER BY count(*) DESC;

SELECT status, safe_error_code, count(*),
       max(now() - created_at) AS oldest_age
FROM im_model_change_outbox
WHERE status IN ('pending', 'processing', 'failed')
GROUP BY status, safe_error_code;

SELECT count(*) AS expired_claims
FROM im_model_change_outbox
WHERE status = 'processing'
  AND (claim_until IS NULL OR claim_until <= now());
```

Page if audit failures are non-zero, catalog delivery fails, dispatch retry age
keeps rising, or expired claims do not recover on the next processor tick.

## Containment and evidence

For a suspected request, preserve the attempt row and related outbox row by
`id`, `idempotency_key`, `correlation_id`, `actor_user_id`, and
`auth_session_id`. Export only the bounded audit columns needed for the
investigation; do not export prompts or credentials.

Handle these as separate containment tracks:

- Model-policy track: application/model pair, durable decision, outbox state,
  and agent-pi message ID.
- Account/session track: actor account, auth session revocation, credential
  rotation, and account ownership evidence.
- Credit/registration track: issuance, transfers, promotion/referral abuse, and
  payment reconciliation.

The current model-change audit does not provide reliable network-source
attribution. Do not claim an IP, device, or person from these rows alone.
Credit/registration-abuse prevention remains deferred and must not block this
policy rollout.

## Rollback

1. Immediately set `MODEL_CHANGE_OUTBOX_ENABLED=false` to stop new dispatch and
   publication claims. Keep the gateway policy and audit path deployed.
2. Do not drop the audit/outbox tables during incident rollback; they are
   evidence and allow safe replay after recovery.
3. If the client has a compatibility problem, roll back only the client. The
   server continues to reject fixed/unsupported mutations.
4. Repair agent-pi model resolution or idempotent enqueue, then re-enable the
   outbox and confirm old pending rows reuse their existing attempt IDs.
5. To retire a model, disable it in the Team9 catalog first, wait until clients
   stop selecting it, and remove the agent-pi resolver only afterward.

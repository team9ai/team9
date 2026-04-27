# k6 load baseline

Phase 9 / Task 9.5 — manual / nightly load baseline for the
ahand-hub ↔ team9-gateway hot paths.

This directory is **not** PR-gated. Running k6 against `dev` requires a
real ahand-hub, gateway, control-plane JWT, and an online daemon —
none of which CI has on-demand. The baseline reports are uploaded as
nightly CI artifacts for before/after diffing.

## Files

| File                               | Purpose                                                                                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ahand-load-baseline.js`           | k6 entrypoint. Two scenarios: `webhook_throughput` (gateway POST `/api/v1/ahand/hub-webhook`) and `control_plane_spawn` (hub POST `/api/control/jobs`). |
| `scripts/gen-webhook-payloads.mjs` | Pre-signs a batch of webhook envelopes. k6's Goja VM doesn't expose Node's HMAC, so signing has to happen out-of-band.                                  |

## Running against the `dev` environment

```bash
# 1. Pull the webhook secret + control-plane JWT secret from your environment-specific store
export AHAND_HUB_WEBHOOK_SECRET=$(...)
export CP_JWT=$(...)

# 2. Pre-sign the webhook batch
node k6/scripts/gen-webhook-payloads.mjs > /tmp/webhook-payloads.json

# 3. Run k6
GATEWAY_URL=https://gateway.dev.team9.ai \
HUB_URL=https://ahand-hub.dev.team9.ai \
CP_JWT="$CP_JWT" \
TEST_DEVICE_ID=<dev-device-id> \
WEBHOOK_PAYLOADS_JSON=/tmp/webhook-payloads.json \
k6 run k6/ahand-load-baseline.js --out json=/tmp/k6-report.json
```

`k6` is not bundled with this repo. Install it with `brew install k6` on macOS or follow [k6.io/docs/getting-started/installation](https://k6.io/docs/get-started/installation/).

## Tunables

All knobs are environment variables on `k6 run`:

| Variable                                       | Default       | Purpose                                                                                                              |
| ---------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------- |
| `WEBHOOK_RATE`                                 | `1000`        | Webhook POSTs/sec target. Spec § 9.4.11 calls for 10k/s — set this higher when running from a multi-host k6 cluster. |
| `WEBHOOK_DURATION`                             | `1m`          | How long to sustain the webhook scenario.                                                                            |
| `WEBHOOK_PREALLOCATED_VUS` / `WEBHOOK_MAX_VUS` | `200` / `800` | k6 VU budget. Bump if `webhook_throughput` complains about not hitting the target rate.                              |
| `SPAWN_VUS`                                    | `100`         | Concurrent control-plane spawn callers.                                                                              |
| `SPAWN_DURATION`                               | `2m`          | Spawn-scenario duration.                                                                                             |
| `SPAWN_START_TIME`                             | `10s`         | Delay before the spawn scenario fires (lets the webhook scenario reach steady state first).                          |
| `SKIP_WEBHOOK_SCENARIO`                        | unset         | Set to `1` to skip the webhook scenario (e.g. when only the hub is up).                                              |
| `SKIP_SPAWN_SCENARIO`                          | unset         | Set to `1` to skip the spawn scenario (e.g. when no online daemon is available).                                     |

## What the thresholds mean

The `options.thresholds` block flags **regressions**, not absolute SLOs:

- `webhook_throughput` p95 < 100ms / p99 < 200ms — what the gateway should hit when the receive path is healthy. A blown threshold means either the gateway pod is undersized or the webhook handler grew a slow path.
- `control_plane_spawn` p95 < 300ms / p99 < 500ms — the hub's job-dispatch path covers a DB lookup + WebSocket send + (often) a webhook re-emit on `device.online`. Higher tail than the webhook scenario by design.
- `http_req_failed` rate < 1% (webhook) / < 2% (spawn) — anything above means the test setup is broken (wrong JWT, device offline, secret mismatch). The script's `abortOnFail` aborts within 10s when this happens.

## Why these scenarios and not three

The plan's third scenario — "1000 connected daemons" — needs k6's
WebSocket extension or a custom daemon driver, neither of which fits
into this single-script baseline. We track the daemon-count axis via
the hub's connection metrics (`ahand_hub_connected_daemons`) under
load already; opening 1000 mock daemons just to re-prove the same
metric isn't worth the test infra.

# Local CDP E2E Debugging Guide

This guide records how to bring up the Team9 + aHand + agent-pi local browser
automation path for debugging.

## Scope

This is a debugging runbook, not a product plan.

The chain being debugged is:

```text
Team9 desktop
  -> embedded ahandd
  -> aHand Hub
  -> Team9 Gateway
  -> Team9 im-worker
  -> agent-pi / claw-hive
  -> ahand-host
  -> aHand Hub
  -> local ahandd
  -> browser provider
```

Team9 does not directly execute agent-pi tools. Team9 starts and configures the
agent session, and im-worker injects aHand host config into the session.

## Current State

Team9 now supports the Team9-side provider selection contract:

- Tauri `browser_status` returns local `browserProviders`.
- Team9 desktop stores `selectedProvider` locally per user and local device.
- Team9 sends `clientContext.browser.selectedProvider` when a provider is known.
- Gateway validates `clientContext.browser.selectedProvider`.
- im-worker passes `capabilities` and `browser.selectedProvider` into
  `ahand-host.config`.

Full CDP E2E still depends on external pieces:

- aHand must publish an `ahandd` build that reports provider availability and can
  execute CDP browser jobs.
- agent-pi must consume `ahand-host.config.capabilities` and
  `ahand-host.config.browser.selectedProvider`.
- agent-pi must register generic browser tools when the `browser` capability is
  present.

Until the new aHand build is pinned by Team9, Team9's local desktop status may
only expose `playwright`.

## Prerequisites

Install dependencies:

```bash
pnpm install
```

Prepare environment files:

```bash
cp apps/server/.env.example apps/server/.env
cp apps/client/.env.example apps/client/.env
```

Minimum Team9 server env values:

```env
GATEWAY_PORT=3000
IM_WORKER_PORT=3001
IM_WORKER_GRPC_URL=localhost:3001
EDITION=community

POSTGRES_USER=postgres
POSTGRES_PASSWORD=
POSTGRES_DB=team9
DB_PORT=5432

REDIS_PASSWORD=
REDIS_PORT=6379

JWT_PRIVATE_KEY="-----BEGIN EC PRIVATE KEY-----
...
-----END EC PRIVATE KEY-----"
JWT_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----
...
-----END PUBLIC KEY-----"
JWT_REFRESH_PRIVATE_KEY="-----BEGIN EC PRIVATE KEY-----
...
-----END EC PRIVATE KEY-----"
JWT_REFRESH_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----
...
-----END PUBLIC KEY-----"

INTERNAL_AUTH_VALIDATION_TOKEN=replace-with-shared-local-secret
```

For aHand integration, also set:

```env
AHAND_HUB_URL=http://localhost:<ahand-hub-port>
AHAND_HUB_SERVICE_TOKEN=replace-with-ahand-hub-service-token
AHAND_HUB_WEBHOOK_SECRET=replace-with-ahand-webhook-secret
GATEWAY_INTERNAL_URL=http://localhost:3000
```

For agent-pi / claw-hive integration, set the values expected by the local
agent-pi environment. On the Team9 side these are commonly:

```env
CLAW_HIVE_API_URL=http://localhost:<claw-hive-port>
CLAW_HIVE_AUTH_TOKEN=replace-with-pre-shared-key
```

Client env should point at the local Gateway:

```env
VITE_API_BASE_URL=http://localhost:3000/api
VITE_APP_URL=http://localhost:1420
VITE_DESKTOP_DEEP_LINK_SCHEME=team9-local
```

## Start Team9

Run migrations:

```bash
pnpm db:migrate
```

Start the Team9 backend services:

```bash
pnpm dev:server:all
```

Expected local services:

- Gateway: `http://localhost:3000`
- im-worker: `localhost:3001`
- task-worker: `localhost:3002`

Start the Team9 desktop app:

```bash
pnpm dev:desktop
```

## Start aHand

Start the aHand Hub using the aHand repository's local development command.

Verify:

- Hub URL matches `AHAND_HUB_URL`.
- Hub service token matches `AHAND_HUB_SERVICE_TOKEN`.
- Hub webhook secret matches `AHAND_HUB_WEBHOOK_SECRET`.
- Hub can call Team9 Gateway at `http://localhost:3000`.

Then in Team9 desktop:

1. Open device settings.
2. Enable this local device.
3. Open Browser setup.
4. Install browser runtime if needed.
5. Turn on "Available to agents".
6. Select the browser provider when more than one provider is available.

Expected Team9 desktop behavior:

- `browser_status` returns `browserProviders`.
- Provider select only shows providers reported by local status.
- Team9 stores the selected provider locally per user and device.

## Start agent-pi / claw-hive

Start the local agent-pi / claw-hive service using that repository's development
command.

Verify agent-pi can:

- receive session creation requests from Team9;
- consume `ahand-host.config.capabilities`;
- consume `ahand-host.config.browser.selectedProvider`;
- register generic browser tools when `browser` is present;
- pass the selected provider through to aHand jobs without rewriting it.

Team9 expects im-worker to inject host config shaped like:

```json
{
  "capabilities": ["browser"],
  "browser": {
    "enabled": true,
    "selectedProvider": "cdp"
  }
}
```

When Team9 has no selected provider, `selectedProvider` should be omitted.

## E2E Debug Flow

Use this order when validating the full path:

1. Enable the local device in Team9 desktop.
2. Install and enable the browser runtime.
3. Confirm embedded `ahandd` is online.
4. Confirm aHand Hub receives the local device status.
5. Confirm aHand Hub reports capabilities to Team9 Gateway.
6. Confirm Gateway persists device capabilities.
7. Send an agent message from Team9 desktop.
8. Confirm the message request includes:

```json
{
  "clientContext": {
    "kind": "macapp",
    "deviceId": "<local-device-id>",
    "browser": {
      "selectedProvider": "cdp"
    }
  }
}
```

9. Confirm im-worker injects `ahand-host.config.capabilities`.
10. Confirm im-worker injects `ahand-host.config.browser.selectedProvider`.
11. Confirm agent-pi registers browser tools for the session.
12. Run a simple browser task:

```text
Open https://example.com and tell me the page title.
```

13. Confirm aHand Hub receives the tool job.
14. Confirm local `ahandd` executes the job.
15. Confirm Team9 displays the tool call result.

## CDP-Specific Debug Flow

Use this only after aHand has published and Team9 has pinned an `ahandd` build
with CDP support.

1. Start Chrome with remote debugging enabled, or use the aHand-supported CDP
   launch path.
2. Log into a test site in that Chrome profile.
3. In Team9 desktop, confirm `browserProviders` includes `cdp`.
4. Select `cdp` in Browser setup.
5. Send a task that needs the existing browser session:

```text
Use my current Chrome session and read the title of the page I am logged into.
```

Expected result:

- Team9 sends `selectedProvider: "cdp"`.
- im-worker passes `selectedProvider: "cdp"` to `ahand-host.config.browser`.
- agent-pi passes provider metadata through to aHand.
- aHand executes through CDP.
- The browser job sees the authenticated browser state without another login.

## Log Checkpoints

Check these points when something fails:

### Team9 Desktop

- `browser_status` response has expected `browserProviders`.
- provider select shows only available providers.
- selected provider survives app reload on the same user/device.
- selected provider clears when the local device id changes.

### Gateway

- create-message request accepts `clientContext.browser.selectedProvider`.
- aHand device webhook stores capabilities.
- internal aHand control-plane endpoint returns device capabilities.

### im-worker

- `AhandControlPlaneClient` parses `capabilities`.
- `AhandBlueprintExtender` receives `clientContext.browser.selectedProvider`.
- generated `ahand-host.config` contains `capabilities`.
- generated `ahand-host.config.browser.selectedProvider` is present when Team9
  sent it.

### agent-pi

- `ahand-host` sees `capabilities`.
- browser tools are registered only when `browser` is present.
- provider is passed as internal metadata, not exposed as model-facing tool
  choice.
- provider is not silently rewritten from `cdp` to `playwright`.

### aHand

- local daemon is online.
- Hub receives local device capability updates.
- browser job reaches local daemon.
- provider-specific execution path is selected by aHand.

## Common Failure Modes

No browser provider appears in Team9:

- Check whether Team9 desktop is running as Tauri, not web-only.
- Check `browser_status`.
- Check whether browser runtime install completed.
- Check whether the current aHand build can report provider availability.

`selectedProvider` is absent from messages:

- Confirm the user opened Browser setup after local status was available.
- Confirm the selected provider is available in `browserProviders`.
- Confirm current desktop user id is loaded.
- Confirm local device id did not change.

agent-pi has no browser tools:

- Confirm aHand device capabilities include `browser`.
- Confirm Gateway internal endpoint returns `capabilities`.
- Confirm im-worker passes `capabilities` into `ahand-host.config`.
- Confirm agent-pi consumes the new config field.

CDP falls back to Playwright:

- Team9 should not perform this fallback after the user selected `cdp`.
- Check agent-pi and aHand logs for provider rewriting.
- If aHand cannot execute CDP, the job should fail visibly instead of silently
  becoming Playwright.

## Useful Local Verification Commands

Team9 tests for this chain:

```bash
pnpm --filter @team9/client test -- \
  src/stores/__tests__/useAhandStore.test.ts \
  src/services/api/__tests__/im-clientContext.test.ts \
  src/i18n/__tests__/ahand.test.ts

pnpm -C apps/server --filter @team9/gateway test -- \
  src/im/messages/dto/create-message.dto.spec.ts

pnpm -C apps/server --filter @team9/im-worker test -- \
  src/ahand/ahand-control-plane.client.spec.ts \
  src/ahand/ahand-blueprint.extender.spec.ts

cargo test -p team9 browser_runtime
```

Type checks:

```bash
pnpm -C apps/client run typecheck
pnpm -C apps/server --filter @team9/gateway exec tsc --noEmit
pnpm -C apps/server --filter @team9/im-worker exec tsc --noEmit
```

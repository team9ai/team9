# Chrome DevTools CDP Capability Plan

Date: 2026-06-03

## Purpose

This document records the plan for adding Chrome DevTools Protocol (CDP)
capability to Team9's desktop client and making it available to agents through
the existing aHand and agent-pi integration.

The core product requirement is not just "browser automation". The requirement
is that agent browser calls can use an existing Chrome session/profile/cookie
state when the user explicitly enables that mode. A dedicated Playwright
automation profile is sufficient for generic browser automation, but it does
not satisfy "use my already logged-in Chrome state" unless that state lives in
the same managed profile. Reusing an already-running Chrome session requires a
CDP attach or managed CDP Chrome flow.

The intended audience is the Team9 client/server team, the aHand team, and the
agent-pi team. The goal is to align on ownership, contracts, and rollout order
before implementation.

## Current Understanding

Team9 does not call agent-pi through aHand by default. The normal agent path is:

```text
Team9 client
  -> Team9 Gateway / WebSocket / REST
  -> im-worker or gateway service
  -> ClawHiveService
  -> agent-pi / claw-hive
```

aHand is an optional local-device execution backend injected into agent-pi
sessions. It is used when an agent needs to operate on the user's local machine,
for example shell execution or browser automation.

The current aHand path is:

```text
Team9 client Tauri
  -> embedded ahandd
  -> aHand Hub WebSocket
  -> agent-pi ahand-host component
  -> local job execution on user's machine
```

Team9 already has a browser runtime setup surface in the Tauri client:

- `browser_status`
- `browser_install`
- `browser_set_enabled`

Those commands live in:

- `apps/client/src-tauri/src/ahand/browser_runtime.rs`
- `apps/client/src-tauri/src/ahand/runtime.rs`

Today this setup mainly installs/checks browser runtime prerequisites, writes
`~/.ahand/config.toml`, toggles `[browser].enabled`, and reloads the embedded
`ahandd`.

aHand already has a Playwright-backed browser path:

- `ahandd` reports the `browser-playwright-cli` capability when browser support
  is enabled and available.
- `BrowserRequest` / `BrowserResponse` already carry browser action requests
  and binary screenshot/PDF results.
- `ahandd` currently executes browser commands through `playwright-cli`.

That existing path is useful and should remain, but it is not the same as CDP
session reuse. This plan separates generic browser automation from CDP-backed
session/profile reuse.

## Desired End State

An agent-pi session can discover that a user's local device supports browser
automation and, when explicitly enabled, browser automation against an existing
or managed CDP Chrome session. It can expose appropriate browser tools to the
model, execute those tools through aHand on the user's machine, and stream
results back to Team9.

There are two browser modes:

1. **Managed Playwright browser**: aHand uses Playwright / `playwright-cli` and
   an aHand-managed browser profile. This is suitable for normal browser
   automation and can persist cookies inside that managed profile.
2. **CDP session reuse**: aHand connects to a Chrome DevTools endpoint for a
   Chrome process that was launched with remote debugging, or launches/manages
   such a Chrome process. This is the mode required when the user wants agents
   to operate with an existing Chrome profile/session/cookie state.

At a high level:

```text
User enables browser and optionally CDP session reuse in Team9 desktop client
  -> embedded ahandd reports capability to aHand Hub
  -> aHand Hub webhooks capabilities to Team9 Gateway
  -> Team9 persists device capabilities
  -> im-worker injects ahand-host with capabilities into agent-pi session
  -> agent-pi registers browser/CDP tools for that session
  -> tool calls execute through aHand Hub on local ahandd
  -> results stream back through existing job/session event paths
```

## Proposed Capability Names

This section records the phase-1 contract Team9 should align with aHand and
agent-pi on.

Recommended canonical capability:

```json
["exec", "browser"]
```

Capability semantics:

- `browser`: the device supports agent browser tools through aHand.
- Provider details are not encoded as separate capabilities. aHand reports the
  available browser providers separately so Team9 can render user-level
  settings.

Recommended Hub/Gateway capability payload:

```json
{
  "capabilities": ["exec", "browser"]
}
```

Recommended raw local provider status returned by aHand/Tauri browser status:

```ts
{
  browserProviders: Array<"cdp" | "playwright">;
}
```

Team9 combines that raw provider availability with the per-user/per-device
selection stored in `useAhandStore` to produce the effective local UI state:

```ts
{
  browserProviders: Array<"cdp" | "playwright">;
  selectedProvider?: "cdp" | "playwright";
}
```

For this phase, `browserProviders` should be treated as aHand/local-runtime
status rather than a durable Team9 business concept. It is meaningful only in
the context of a specific aHand runtime and is primarily useful for the Team9
desktop settings UI. More granular provider states such as installed,
configured, enabled, unavailable, and diagnostic reason remain internal to
aHand.

`browserProviders` means the provider can be used by aHand in the current local
runtime/configuration. It does not mean the backing browser process is already
running. This matches the existing Playwright behavior: Playwright can be
reported as available before a Playwright browser has been opened. Likewise,
CDP can be reported when aHand is configured and able to attach to or launch a
CDP Chrome session on demand.

Decision: `browserProviders` is an independent local status field. It does not
cross the Gateway/im-worker boundary in the first implementation. Team9 and
agent-pi must not infer provider availability from `capabilities` or legacy
capability aliases. If `browserProviders` is absent, provider availability is
unknown and the Team9 UI should not present provider choices from aliases
alone.

Team9's server-side contract carries the stable `browser` capability and the
user's selected provider. aHand performs final provider validation at job
execution time.

Provider semantics:

- `cdp`: browser automation can use Chrome DevTools Protocol against an
  existing or managed CDP Chrome endpoint, and can therefore reuse the
  configured Chrome session/profile/cookie state.
- `playwright`: browser automation is backed by aHand's Playwright /
  `playwright-cli` provider.

Compatibility aliases:

- Existing `browser-playwright-cli` maps to capability `browser` only for
  accepting legacy aHand capability payloads. It does not imply
  `browserProviders: ["playwright"]`, and it must not cause agent-pi to register
  the old `browser-playwright-cli` skill.
- If aHand temporarily emits `browser-cdp`, `browser-cdp-cli`, or
  `browser.cdp`, Team9/agent-pi should treat them as capability `browser` for
  legacy gating only. They do not imply `browserProviders: ["cdp"]`.
- Long-term, avoid provider-specific capability names. Keep `browser` as the
  stable capability and keep provider availability in `browserProviders`.

Rollout rule:

- During the compatibility window, aHand should emit both the stable capability
  and existing legacy aliases through Hub/Gateway capability payloads, for
  example:

```json
{
  "capabilities": ["exec", "browser", "browser-playwright-cli"]
}
```

- Local Team9 Tauri/aHand browser status can separately include provider
  metadata:

```ts
{
  browserProviders: ["cdp", "playwright"],
  selectedProvider: "cdp"
}
```

- Team9 and agent-pi should treat `browser-playwright-cli` as a legacy alias
  for the `browser` capability only.
- Team9 client should read provider availability only from aHand/local
  `browserProviders`, not from legacy aliases.
- The legacy alias can be removed only after Team9 Gateway, im-worker, and
  agent-pi all consume `browser` and no active code path gates browser tools on
  `browser-playwright-cli`.

## Team9 Responsibilities

### 1. Client Tauri Runtime Setup

Files:

- `apps/client/src-tauri/src/ahand/browser_runtime.rs`
- `apps/client/src-tauri/src/ahand/runtime.rs`
- `apps/client/src/hooks/useBrowserRuntime.ts`

Planned work:

- Keep using the existing Tauri command surface for browser runtime setup.
- Extend browser status if needed to include CDP-specific readiness.
- Extend Tauri `browser_status` to return local provider availability. Team9
  reads the selected provider from `useAhandStore` and computes the effective
  provider used for UI and message `clientContext`.

```ts
{
  browserProviders: Array<"cdp" | "playwright">;
}
```

- Confirm or add config fields needed by `ahandd`, for example:

```toml
[browser]
enabled = true
selected_provider = "cdp"
cdp_enabled = true
cdp_mode = "user_profile"
cdp_endpoint = ""
playwright_enabled = true
```

First implementation note: aHand should extend the current flat
`BrowserConfig` rather than migrating to nested provider config in this phase.
The nested provider shape can be revisited after the browser provider contract
has settled.

Playwright-style reuse decisions:

- Reuse the existing `[browser].enabled` top-level switch. It means the local
  browser tool surface is enabled, independent of which provider is selected.
- Reuse the existing browser setup/status command surface:
  `browser_status`, `browser_install`, and `browser_set_enabled`.
- Reuse the current flat config style. Add provider fields beside the existing
  browser fields instead of introducing nested config in phase 1.
- Treat Playwright and CDP as sibling providers under the same browser feature:
  `playwright_enabled` controls Playwright availability and `cdp_enabled`
  controls CDP availability.
- Reuse the same local reload path after browser config changes. Team9 should
  call the Tauri/aHand setup command and let it persist config and reload
  `ahandd`.
- Reuse the existing browser runtime UI surface. Add provider status/selection
  inside the current device/browser setup area instead of creating a separate
  CDP settings page.

CDP-specific settings that cannot be reduced to Playwright settings:

- `selected_provider`: chooses which provider Team9 asks aHand/agent-pi to use
  for Team9-owned browser sessions.
- `cdp_enabled`: explicitly gates whether CDP can be offered as a provider.
- `cdp_mode`: phase-1 mode is `user_profile`, meaning aHand uses the user's
  Chrome profile/session/cookie state.
- `cdp_endpoint`: optional explicit local endpoint. Empty means aHand checks
  known aHand-owned CDP endpoints first, then launches Chrome with remote
  debugging if needed.
- Chrome profile, remote-debugging port allocation, localhost binding, profile
  lock handling, target tracking, and attach-vs-launched lifecycle rules remain
  CDP provider internals owned by aHand.

First-phase Team9/runtime decisions:

- Team9 should prefer calling Tauri/aHand setup commands that persist browser
  config over manually editing config files in React.
- Team9 exposes a simple local provider selector, not low-level Chrome path or
  profile selection.
- CDP uses aHand defaults for the user's normal Chrome profile.
- If CDP is selected and no explicit or known aHand-owned endpoint is alive,
  aHand owns launching Chrome with remote debugging and connecting to it.
- Explicit endpoint attach can exist as an aHand/runtime capability, but Team9
  does not need to expose manual endpoint entry in the first UI.

Provider selection ownership:

- aHand is authoritative for reporting which providers are available for
  on-demand use via local browser runtime status, such as `browserProviders`.
- Team9 desktop is authoritative for the local user-level selected provider.
  The setting is stored locally per user/device because available providers
  change when the user switches machines.
- If a local aHand config also contains `selected_provider`, Team9 treats it as
  a daemon default/backward-compatibility value, not as the authoritative
  per-user Team9 selection.
- agent-pi is a transport layer for provider selection: it receives Team9's
  selected provider in session config and passes it through on browser jobs.
  agent-pi should not choose or rewrite providers.

### 2. Client UI

Files:

- `apps/client/src/components/dialog/devices/ThisMacSection.tsx`
- `apps/client/src/hooks/useBrowserRuntime.ts`
- `apps/client/src/services/ahand-api.ts`

Planned work:

- Show browser readiness and CDP session-reuse readiness in the local
  device/browser setup UI.
- Add a user-level browser provider setting. The UI only shows providers that
  aHand reports as available through local browser runtime status:
  - show CDP only when `browserProviders` includes `cdp`;
  - show Playwright only when `browserProviders` includes `playwright`;
  - if only one provider is available, select it by default and avoid presenting
    an unavailable choice.
- Store the selected provider locally per user/device. Do not persist it in
  Team9 server-side user preferences for this phase.
- Reuse the existing `useAhandStore` persisted local store where possible. Add
  the selected browser provider to the existing per-user aHand state instead of
  creating a new server-side preference model.
- Store it under the existing per-user aHand state, for example:

```ts
interface UserAhandState {
  enabled: boolean;
  deviceId: string | null;
  hubUrl: string;
  browser?: {
    selectedProvider?: "cdp" | "playwright";
  };
}
```

- If the previously selected provider is not available on the current device,
  select an available provider from the local `browserProviders` list. Do not
  show unavailable providers as selectable options.
- Optionally show device capabilities returned by the Gateway:
  `capabilities: ["exec", "browser"]`.
- Provider availability does not need to be shown from Gateway data. It can come
  from local Tauri/aHand runtime status because it is meaningful only for the
  local device/runtime.
- The CDP option must clearly state that it uses the user's local Chrome
  profile/session/cookie state. No extra confirmation dialog is required in the
  first phase.
- Keep the UI as a setup/status surface, not as a direct CDP client.

Non-goal:

- The React app should not directly connect to a Chrome CDP websocket for agent
  tool execution. Local execution should stay behind `ahandd`.

### 3. Gateway Device API and Capability Persistence

Files:

- `apps/server/apps/gateway/src/ahand/ahand.service.ts`
- `apps/server/apps/gateway/src/ahand/ahand-webhook.service.ts`
- `apps/server/apps/gateway/src/ahand/dto/device.dto.ts`
- `apps/server/apps/gateway/src/ahand/dto/internal.dto.ts`
- `apps/server/libs/database/src/schemas/im/ahand-devices.ts`

Current state:

- `im_ahand_devices.capabilities` already exists.
- `AhandWebhookService` already persists capabilities from `device.online` and
  `device.registered` webhook data.
- Gateway internal DTO already includes `capabilities`.
- Public `DeviceDto` currently does not expose `capabilities`.
- `browserProviders` is not part of the current Gateway DTO contract. Current
  phase-1 decision: keep it out of the Gateway DTO unless a later use case
  proves that server-side provider availability is required and explicitly
  reopens this boundary.

Planned work:

- Add `capabilities: string[]` to public `DeviceDto` if the client UI needs to
  display them.
- Ensure `toDeviceDto()` includes `row.capabilities ?? []`.
- Do not add `browserProviders` to Gateway DTOs in the first implementation if
  provider availability is only needed by the local desktop settings UI.
- Do not persist `browserProviders` in `im_ahand_devices`, and do not derive it
  from `capabilities` or legacy aliases.
- Keep existing webhook semantics:
  - `device.online` capabilities are authoritative.
  - `device.registered` with empty capabilities should not wipe a later online
    capabilities value.
  - Provider availability is local aHand runtime status; Gateway should not
    become the source of truth for it unless this decision is reopened.

### 4. im-worker Capability Propagation

Files:

- `apps/server/apps/im-worker/src/ahand/ahand-control-plane.client.ts`
- `apps/server/apps/im-worker/src/ahand/ahand-blueprint.extender.ts`

Current gap:

Gateway internal endpoints return `capabilities`, but the im-worker Zod schema
does not parse that field yet. `AhandBlueprintExtender` also does not pass
capabilities or the user-selected browser provider into `ahand-host.config`.

Reuse existing context path:

- Client already injects `clientContext` on message sends.
- Gateway already persists top-level `clientContext` into
  `messages.metadata.clientContext`.
- im-worker already passes `clientContext` into `AhandBlueprintExtender`.
- Therefore the preferred implementation is to extend the existing
  `clientContext` shape with `browser.selectedProvider`, instead of adding a new
  Team9 server preference API or a new session bootstrap channel.
- Gateway `ClientContextDto` must allow the nested
  `browser.selectedProvider` field so the existing metadata merge preserves it.

Planned work:

- Extend `DeviceSchema`:

```ts
capabilities: z.array(z.string()).default([]);
```

- Extend `AhandDeviceSummary` usage accordingly.
- Extend im-worker `ClientContextRaw` to include optional
  `browser.selectedProvider`.
- Pass capabilities into `ahand-host` config:

```ts
config: {
  deviceId: d.hubDeviceId,
  deviceNickname: d.nickname,
  devicePlatform: d.platform,
  capabilities: d.capabilities,
  browser: {
    enabled: true,
    selectedProvider: userBrowserProvider,
  },
  callingUserId: input.callingUserId,
  callingClient,
  gatewayInternalUrl: this.gatewayInternalUrl,
  gatewayInternalAuthToken: token,
  hubUrl: this.hubUrl,
}
```

Expected result:

- agent-pi can make per-session tool registration decisions based on the
  actual online device capabilities.

## aHand Responsibilities

Repository outside Team9:

- `https://github.com/team9ai/aHand`
- Team9 currently depends on `ahandd` tag `rust-v0.1.13`.

Planned work:

- Implement or confirm Chrome/CDP execution support in `ahandd`.
- Define the job protocol for browser/CDP actions.
- Extend the current flat `BrowserConfig` with first-phase provider fields
  instead of introducing nested provider config:
  - `selected_provider`
  - `cdp_enabled`
  - `cdp_mode`
  - `cdp_endpoint`
  - `playwright_enabled`
- Report the stable `browser` capability when at least one browser provider is
  available for on-demand use.
- Expose available browser providers through local browser status, for example:
  `browserProviders: ["cdp", "playwright"]`.
- Treat provider status as "can use this provider", not "browser process is
  currently running". CDP may be reported when aHand can attach to an explicit
  endpoint or launch/probe a user-profile CDP Chrome session on demand.
- Own Chrome process/profile/debug-port management for CDP mode.
- Support an attach-existing CDP mode for explicit endpoints such as
  `http://127.0.0.1:9222`.
- When `cdp_endpoint` is set, aHand should probe and connect to that explicit
  local endpoint.
- When `cdp_endpoint` is empty, aHand should probe only endpoints it already
  knows about or owns from prior aHand-launched CDP sessions. If no usable
  endpoint is alive, aHand should allocate a localhost-only remote-debugging
  port, launch Chrome with the user's profile and remote debugging enabled,
  then connect to that endpoint.
- When aHand launches Chrome, it must automatically choose an available local
  remote-debugging port instead of requiring a fixed port. Remote debugging must
  bind only to localhost.
- Report the stable `browser` capability through aHand Hub. Expose
  provider-specific readiness through local aHand/Tauri browser status for the
  Team9 desktop UI; do not require provider metadata to cross Hub/Gateway in
  phase 1.
- Enforce provider availability at execution time. If Team9/user selected
  `cdp` but CDP is unavailable, aHand should return an error through existing
  aHand job/browser response fields instead of silently falling back to
  Playwright.
- Stream job output in the existing aHand job event format.

First-phase aHand/runtime rules:

- `ahandd` should support both explicit endpoint attach and aHand-launched
  Chrome. If `cdp_endpoint` is empty, use the aHand-launched user-profile path.
- Later phase: define UX and warnings before allowing arbitrary existing-tab
  control. User-profile CDP itself is in scope for this phase.
- Screenshot and binary artifact contract changes are out of scope for this
  phase. Do not include screenshot-specific delivery work in this plan.
- First-phase `params_json` parsing should be permissive. Strict schema
  validation can wait until provider/target fields move into a formal transport
  contract.

## agent-pi Responsibilities

Repository outside Team9:

- `team9-agent-pi` / claw-hive runtime

Planned work:

- Update the `ahand-host` component to consume `config.capabilities` and the
  `browser` config block.
- Add an agent-transparent browser tool surface. The model should not know
  whether a browser call uses Playwright or CDP.
- Do not keep or register the old `browser-playwright-cli` skill as a
  transitional model-facing surface. The only model-facing browser surface for
  this plan is the generic browser tool/skill surface.
- Add a new provider-agnostic browser skill, for example
  `packages/agent-components/skills/browser/SKILL.md`, that documents the
  generic browser tools. This skill replaces `browser-playwright-cli` as the
  browser guidance surface and must not instruct the model to run
  `playwright-cli` or choose a provider.
- agent-pi may expose generic model-facing browser tools, for example:
  - `browser_navigate`
  - `browser_click`
  - `browser_type`
  - `browser_evaluate`
  - `browser_wait_for`
- agent-pi must not invent new `BrowserRequest.action` names. It should translate
  any model-facing wrapper tool into the existing Playwright-compatible
  `BrowserRequest.action` contract:
  - `browser_navigate` -> `action: "open"`;
  - `browser_click` -> `action: "click"`;
  - `browser_type` -> `action: "fill"` when a selector/ref is provided, or
    `action: "type"` when typing into the focused element;
  - `browser_evaluate` -> `action: "eval"`;
  - `browser_wait_for` -> `action: "wait"`.
- aHand already has `wait` semantics in the OpenClaw browser path. Phase 1
  should expose the same `wait` behavior through the `BrowserRequest` path
  instead of inventing a new action name.
- `browser_screenshot` is deferred from this plan.
- Do not make agent-pi responsible for provider availability policy beyond the
  existence of the `browser` capability. agent-pi may pass
  `selectedProvider` through to aHand, but aHand owns final provider validation
  and execution.
- Do not silently rewrite a user-selected provider. If Team9 selected `cdp`,
  agent-pi should pass `cdp` through; if aHand cannot execute it, the tool
  result should surface a provider-unavailable error.
- Route generic browser tool calls through aHand Hub browser jobs to the
  selected device, including the Team9-provided selected provider as execution
  metadata when present.
- Normalize tool call/result events so Team9 can display them with existing
  tool event UI.

Resolved agent-pi rules:

- Align with the existing aHand `BrowserRequest` / `BrowserResponse` behavior.
  Do not introduce a new browser transport in agent-pi for the first CDP phase.
- Pass Team9's selected provider through as
  `params_json.selected_provider`.
- If Team9 does not provide `selectedProvider`, agent-pi omits
  `selected_provider`. It does not choose a provider and does not return a
  provider-missing error.
- CDP target scope is already decided for the first phase: `new_tab` and
  `session_tab` only; no arbitrary `active_tab`.
- Legacy `browser-playwright-cli` capability may enable the generic browser
  surface as a `browser` alias, but it must not register the old
  `browser-playwright-cli` skill and must not imply any `browserProviders`
  value.

First-phase target selection rules:

- Browser tools target the calling user's current device by default when
  `clientContext.kind === "macapp"` and `clientContext.deviceId` resolves to an
  online active aHand device with the `browser` capability.
- If multiple devices are online, Team9/agent-pi should not automatically pick a
  different device for browser tools in the first phase.
- If the calling device is unavailable or lacks `browser`, browser tool calls
  should return a normal tool error instead of silently falling back to another
  device.
- Broader cross-device browser target selection is out of scope for phase 1.

## Contract Points

### Device Capabilities

Source of truth:

- `ahandd` declares capabilities to aHand Hub.
- aHand Hub forwards capabilities in device webhooks.
- Team9 Gateway persists capabilities in `im_ahand_devices.capabilities`.
- im-worker passes capabilities into agent-pi session component config.

Suggested data shape:

```json
{
  "capabilities": ["exec", "browser"]
}
```

Provider availability shape for local Team9 desktop settings UI:

```json
{
  "browserProviders": ["cdp", "playwright"]
}
```

### ahand-host Component Config

Proposed Team9-to-agent-pi config:

```json
{
  "deviceId": "hub-device-id",
  "deviceNickname": "macos-device",
  "devicePlatform": "macos",
  "capabilities": ["exec", "browser"],
  "browser": {
    "enabled": true,
    "selectedProvider": "cdp"
  },
  "callingUserId": "team9-user-id",
  "callingClient": {
    "kind": "macapp",
    "deviceId": "hub-device-id",
    "deviceNickname": "macos-device",
    "isAhandEnabled": true
  },
  "gatewayInternalUrl": "https://...",
  "gatewayInternalAuthToken": "...",
  "hubUrl": "https://..."
}
```

### Tool Results

Preferred behavior:

- Browser/CDP tool calls should appear in Team9 as normal agent tool events.
- Streaming progress can use existing aHand job stream where appropriate.
- Final results should include concise text plus structured data when useful.
- Screenshot-specific artifact work is not required for the first CDP phase;
  screenshot behavior is deferred from this plan.

### Browser Job Payloads

The existing aHand `BrowserRequest` shape can remain the transport envelope:

```json
{
  "session_id": "agent-browser-session",
  "action": "open",
  "params_json": "{\"url\":\"https://example.com\"}",
  "timeout_ms": 30000
}
```

For the first implementation, provider selection lives in `params_json` to
avoid changing the protobuf/browser transport in the same phase. Include the
Team9 user-level selected provider when it exists. Keep `action` as the
top-level `BrowserRequest.action`; do not duplicate it inside `params_json`.
Phase 1 should not add new `BrowserRequest.action` names. Both Playwright and
CDP providers should implement the same existing action subset.

Initial `params_json` convention:

```ts
type BrowserParamsJson = {
  selected_provider?: "playwright" | "cdp";
  target?: {
    mode?: "new_tab" | "session_tab";
  };
  url?: string;
  selector?: string;
  element_ref?: string;
  text?: string;
  expression?: string;
  timeout_ms?: number;
};
```

Full Playwright-style request examples:

```json
{
  "session_id": "agent-browser-session",
  "action": "open",
  "params_json": "{\"selected_provider\":\"playwright\",\"url\":\"https://example.com\"}",
  "timeout_ms": 30000
}
```

```json
{
  "session_id": "agent-browser-session",
  "action": "click",
  "params_json": "{\"selected_provider\":\"playwright\",\"element_ref\":\"e12\"}",
  "timeout_ms": 15000
}
```

Full CDP request examples:

```json
{
  "session_id": "agent-browser-session",
  "action": "open",
  "params_json": "{\"selected_provider\":\"cdp\",\"target\":{\"mode\":\"new_tab\"},\"url\":\"https://example.com\"}",
  "timeout_ms": 30000
}
```

```json
{
  "session_id": "agent-browser-session",
  "action": "eval",
  "params_json": "{\"selected_provider\":\"cdp\",\"target\":{\"mode\":\"session_tab\"},\"expression\":\"document.title\"}",
  "timeout_ms": 10000
}
```

If a future protobuf/browser transport revision adds explicit fields, the same
data can move out of `params_json`:

```json
{
  "session_id": "agent-browser-session",
  "action": "open",
  "selected_provider": "cdp",
  "target": {
    "mode": "new_tab"
  },
  "params_json": "{\"url\":\"https://example.com\"}",
  "timeout_ms": 30000
}
```

The long-term contract should make provider/target explicit, but that is not a
requirement for the first CDP phase.

Initial CDP target scope:

- `new_tab` is supported first.
- Existing tab operations are allowed only for tabs created by aHand in the
  same CDP-controlled session.
- aHand should track `session_id` to CDP target/page state so later browser
  actions in the same session reuse the tab it created.
- Phase 1 browser jobs should not require agent-pi to pass a CDP target id.
  aHand should resolve `session_tab` from `session_id` and its own tracked
  target/page state.
- A single job completion should not close the tab. Tabs remain available for
  later actions in the same browser session.
- If aHand launched the Chrome process, aHand owns that browser lifecycle and
  should close it when the browser session or daemon lifecycle ends.
- If aHand attached to an explicit external `cdp_endpoint`, it should not close
  the external browser process.
- Do not support arbitrary `active_tab` control in the first phase.
- Do not attach to or operate on a user's unrelated current tab unless a later
  phase adds explicit UX and approval semantics for that path.

agent-pi should keep provider choice out of the model-facing tool schema. The
model calls generic browser tools; agent-pi either passes Team9's selected
provider through to aHand, or omits it when Team9 has not selected one.
Recommended Team9 session config:

```json
{
  "selectedProvider": "cdp"
}
```

Preferred Team9 `clientContext` extension:

```ts
type ClientContext =
  | {
      kind: "macapp";
      deviceId: string | null;
      browser?: {
        selectedProvider?: "cdp" | "playwright";
      };
    }
  | { kind: "web" };
```

This reuses the existing top-level message `clientContext` injection and
`messages.metadata.clientContext` persistence path.

Policy behavior:

- Team9 UI only lets the user select providers currently reported by aHand.
- Team9 desktop owns local provider fallback. If the selected provider is not
  available on the current device, Team9 picks an available provider from the
  latest local aHand browser runtime status and passes that provider as the new
  selected provider.
- Provider fallback can happen only before a browser job is created; once a job
  reaches aHand with `selected_provider`, aHand validates that provider and must
  return an error instead of falling back.
- agent-pi does not decide whether `cdp` or `playwright` is available and does
  not choose fallbacks. It passes Team9's selected provider through.
- aHand performs final validation at execution time. If the passed provider is
  unavailable, aHand returns an error through existing aHand job/browser
  response fields instead of silently falling back to another provider.
- If `selectedProvider` is omitted, aHand may use its local default provider
  priority only as a daemon-local fallback. This path should be treated as
  backward compatibility; Team9-owned sessions should pass an explicit selected
  provider once provider selection is enabled.
- Do not hot-update an already running agent-pi session when local provider
  availability changes. In phase 1, a provider becoming unavailable during a
  running job/session should surface as an aHand tool error. Team9 local
  fallback applies when settings are refreshed or a later message/session is
  created with fresh `clientContext`.

## Implementation Order

### Phase 1: Contract Alignment

- Agree on capability names.
- Agree that `browser` is the stable server-side capability.
- Agree that provider availability is local aHand runtime status unless this
  decision is explicitly reopened.
- Agree that first-phase browser/CDP provider selection is carried in
  `params_json`.
- Agree on tool names and result shapes.
- Confirm provider-selection ownership:
  - aHand reports providers available for on-demand use;
  - Team9 desktop owns local per-user/per-device selection and fallback;
  - agent-pi passes the selected provider through without choosing providers.
- Confirm that Team9 does not support remote-device provider selection or
  server-side provider availability in the first phase.

### Phase 2: Team9 Capability Plumbing

- Add public `DeviceDto.capabilities` if needed.
- Add im-worker `capabilities` parsing.
- Pass capabilities and Team9's user-selected browser provider into
  `ahand-host.config`.
- Source the user-selected browser provider from local per-user/per-device
  desktop state, not from Team9 server-side preferences.
- Reuse current client plumbing:
  - extend the existing `useAhandStore` persisted state with the selected
    browser provider;
  - extend `ClientContext` with `browser.selectedProvider`;
  - update `buildClientContext()` to read selected provider from
    `useAhandStore`;
  - extend Gateway `ClientContextDto` with optional
    `browser.selectedProvider`;
  - keep Gateway's existing merge into `metadata.clientContext`;
  - update im-worker `ClientContextRaw` and `AhandBlueprintExtender` to read
    `clientContext.browser.selectedProvider`.
- Add tests for Gateway DTO and im-worker injection.

### Phase 3: aHand Browser/CDP Runtime

- Implement or update `ahandd` CDP support.
- Ensure daemon hello reports browser/CDP capability only when ready.
- Ensure `browser_install` / `browser_set_enabled` config is sufficient.
- Add first-phase flat `BrowserConfig` fields for provider selection and CDP
  endpoint configuration.
- Implement a CDP provider that can:
  - probe the configured explicit CDP endpoint when `cdp_endpoint` is set;
  - probe known aHand-owned CDP endpoints when `cdp_endpoint` is empty;
  - connect to an explicit local CDP endpoint when `cdp_endpoint` is set;
  - launch Chrome with the user's profile and remote debugging when
    `cdp_endpoint` is empty and no known aHand-owned endpoint is already alive;
  - automatically allocate an available localhost-only remote-debugging port
    for aHand-launched Chrome;
  - create and track new tabs;
  - close Chrome during session/daemon cleanup only when aHand launched that
    Chrome process;
  - support the existing `BrowserRequest.action` values used by phase 1:
    `open`, `click`, `fill`, `type`, `eval`, and `wait`;
  - expose `wait` through the `BrowserRequest` path using the existing OpenClaw
    wait semantics (`text` polling or delay);
  - reuse the endpoint's browser profile/session/cookie state.
- Keep the existing Playwright provider and report it in `browserProviders`.
- Publish a new `ahandd` tag.
- Update Team9 `Cargo.toml` to the new `ahandd` tag.

### Phase 4: agent-pi Tool Registration

- Update `ahand-host` to register generic browser tools based on capabilities
  and browser config.
- Remove `browser-playwright-cli` skill registration from the browser path. A
  legacy capability alias may still enable the generic browser surface, but it
  must not expose the old Playwright-specific skill to the model.
- Register the new provider-agnostic browser skill alongside the generic
  browser tools when the `browser` capability is present. The skill should
  explain how to use the tools and how to handle browser/provider errors, but it
  should not expose provider selection to the model.
- Keep provider choice transparent to the model.
- Implement tool routing to aHand browser jobs, passing Team9's selected
  provider through as metadata.
- Normalize tool event metadata.
- Add agent-pi tests for capability-gated tool availability and provider
  passthrough.

### Phase 5: End-to-End Verification

Verify the full path:

1. Enable local device in Team9 desktop.
2. Install/enable browser runtime.
3. Confirm `ahandd` online.
4. Confirm aHand Hub emits capabilities.
5. Confirm Gateway stores capabilities.
6. Confirm im-worker injects `ahand-host` with capabilities.
7. Start an agent-pi session.
8. Confirm browser tools are available to the agent.
9. Run a simple Playwright browser task:
   - open a page
   - read title
10. Run a CDP session-reuse task:

- start or attach Chrome with remote debugging;
- log into a site in that Chrome profile;
- ask the agent to open/read the already-authenticated page;
- confirm the agent sees authenticated state without re-login.

11. Confirm Team9 UI displays tool call and result.

## Testing Plan

Team9 tests:

- Gateway:
  - `DeviceDto` includes capabilities.
  - webhook persists `browser`.
  - `ClientContextDto` accepts optional nested `browser.selectedProvider`.
  - `browserProviders` is not persisted in `im_ahand_devices`.
  - `browserProviders` is not inferred from `capabilities` or legacy aliases.
  - internal endpoint returns capabilities.
- im-worker:
  - `AhandControlPlaneClient` parses capabilities.
  - `AhandBlueprintExtender` injects capabilities and the user-selected provider
    into `ahand-host`.
  - missing capabilities defaults to `[]`.
- Client:
  - `ahandApi.DeviceDto` includes capabilities if exposed.
  - browser settings UI only shows providers reported as available by local
    Tauri/aHand runtime status.
  - unavailable providers are not shown as selectable options.
  - selected provider is stored locally per user/device in the existing
    `useAhandStore` persisted state where possible.
  - `buildClientContext()` includes `browser.selectedProvider` for macapp
    contexts when available.
  - CDP option text clearly states that it uses the local Chrome
    profile/session/cookie state.
- Gateway:
  - existing top-level `clientContext` merge preserves nested
    `browser.selectedProvider` in `metadata.clientContext`.

aHand tests:

- daemon reports capability only when browser automation is enabled and at
  least one provider is configured for on-demand use.
- CDP job succeeds against a local Chrome instance.
- CDP job can reuse a configured profile/session/cookie state.
- pure Playwright setup reports `browser` with `browserProviders:
["playwright"]`.
- mixed setup reports `browser` with `browserProviders: ["cdp", "playwright"]`.
- selected unavailable provider returns an error through existing aHand
  job/browser response fields.
- failure cases: Chrome missing, automatic port allocation failure, profile
  locked, timeout.

agent-pi tests:

- browser tools unavailable when capability missing.
- generic browser tools available when `browser` capability is present.
- legacy `browser-playwright-cli` capability enables only the generic browser
  surface and does not register the old `browser-playwright-cli` skill.
- CDP-only devices expose the same generic browser surface and do not expose any
  Playwright-specific model-facing skill.
- selected provider is passed through to aHand browser jobs.
- provider choice is not exposed to the model-facing browser tool schema.
- tool call routes to the selected aHand device with expected browser metadata.
- tool errors are surfaced from existing aHand job/browser response fields as
  normal tool results.

## Risks

- Capability drift: Team9, aHand, and agent-pi must use the same capability
  names.
- Partial rollout: Team9 may pass capabilities before agent-pi consumes them.
- Multiple online devices: agent-pi needs a deterministic target selection
  rule.
- Security: CDP can access sensitive browser state if attached to a user's
  everyday Chrome profile. This mode must be explicitly enabled and clearly
  surfaced to the user.
- Port exposure: Chrome remote debugging must not bind publicly. aHand-launched
  Chrome must use a localhost-only automatically allocated port unless an
  explicit local `cdp_endpoint` is configured.
- Profile safety: CDP is intended to use the user's browser profile. aHand
  should probe for an existing CDP endpoint before launching Chrome, and should
  surface profile-lock/startup failures through existing aHand job/browser
  response fields.
- Development validation: aHand should verify the behavior when the user's
  normal Chrome is already running without remote debugging and `cdp_endpoint`
  is empty. The phase-1 contract allows aHand to return an existing error field
  if the user-profile CDP launch cannot be made reliable in that state.
- Additional confirmation UX is intentionally out of scope for this phase. The
  Team9 settings UI must clearly state that CDP uses the user's local Chrome
  profile/session/cookie state, but it does not require a separate confirmation
  dialog. The first CDP phase should avoid arbitrary active-tab control and only
  operate on tabs aHand creates or tracks.
- Version skew: Team9 pins `ahandd` by git tag, so a new aHand release is
  required for Team9 to consume daemon changes.

## Non-Goals

- React client directly connecting to Chrome CDP.
- Replacing agent-pi's normal tool system with aHand.
- Routing all Team9 agent traffic through aHand.
- Building a second Team9-native local job protocol parallel to aHand.

## Decisions And Remaining Clarifications

Most phase-1 product and Team9 architecture choices are settled. The open
items below are limited to cross-repository implementation details and release
coordination.

### Settled Phase-1 Decisions

1. Provider availability boundary:
   - Decision: provider availability is local aHand runtime
     state used by the Team9 desktop settings UI. It is not a durable Team9
     server-side business concept.
   - Team9 Gateway and im-worker should not persist or infer
     `browserProviders` in the first implementation.
   - Team9 does not support remote-device provider capability display or
     remote-device provider selection in the first phase.
   - If a future remote-management or cross-device UI needs provider
     availability, reopen this decision and define a server-side DTO/storage
     contract.
   - The existing `capabilities` array may temporarily carry legacy aliases for
     compatibility, but those aliases are not a source of provider availability.
   - `browserProviders` means aHand can use the provider on demand. It does not
     require a Playwright or CDP browser process to already be running.

2. User-level browser provider setting:
   - Decision: selected provider is stored locally on the Team9 desktop client,
     scoped per user/device.
   - Reason: provider availability changes when the user switches devices, and
     provider values have no durable meaning outside the local aHand runtime.
   - Team9 does not store selected provider in server-side user preferences for
     this phase.
   - If both CDP and Playwright are available and no prior local selection
     exists, Team9 chooses CDP as the local default because the product
     requirement is to support Chrome profile/session reuse.
   - If the prior local selection is unavailable on the current device, Team9
     selects an available local provider and does not show the unavailable
     provider as selectable.

3. Team9 to aHand propagation:
   - Team9 injects `selectedProvider` into `ahand-host.config`, and
     agent-pi passes it through on each browser job as
     `params_json.selected_provider`.
   - If `selectedProvider` is absent, agent-pi omits
     `params_json.selected_provider`; it does not choose or validate providers.
   - If Team9 also writes a local aHand config value, the per-job/session
     Team9-selected provider wins for Team9-owned sessions.

4. agent-pi responsibility boundary:
   - Decision: agent-pi remains provider-agnostic for model-facing behavior and
     only passes through `selectedProvider`.
   - agent-pi may include provider names in internal metadata, telemetry, or
     logs if useful, but provider names must not appear in the model-facing
     browser tool schema.

5. aHand provider validation:
   - First phase reuses existing aHand job/browser response error fields
     for provider-unavailable, CDP startup, profile-lock, target-lost, and
     timeout failures.
   - For this phase, unavailable providers are omitted from `browserProviders`;
     detailed installed/configured/enabled/diagnostic state remains aHand
     internal.

6. CDP safety and UX:
   - CDP uses the user's browser profile.
   - Team9 settings UI must clearly state that CDP uses the user's local Chrome
     profile/session/cookie state.
   - No separate confirmation dialog is required in the first phase.
   - Later phases must define warnings or approvals before enabling arbitrary
     existing-tab control.
   - If `cdp_endpoint` is set, aHand probes and connects to that explicit local
     endpoint.
   - If `cdp_endpoint` is empty, aHand probes known aHand-owned CDP endpoints
     first, then launches Chrome with remote debugging against the user profile
     if needed.
   - aHand-launched Chrome uses an automatically allocated
     localhost-only remote-debugging port.
   - The case where normal Chrome is already running without remote debugging is
     left for aHand development validation; if it cannot be handled reliably in
     phase 1, aHand should report the failure through existing error fields.

7. Browser job wire shape:
   - First implementation carries `selected_provider` in `params_json`.
   - Initial target mode is `new_tab`; existing-tab operations are limited to
     tabs aHand created/tracked in the same CDP session.
   - Phase 1 does not require agent-pi to pass target ids; `session_tab` is
     resolved by aHand from `session_id`.
   - First-phase parsing can stay permissive; strict schema validation is not
     required before implementation.
   - A future transport revision may add top-level `selected_provider` and
     target fields to `BrowserRequest`.

### Remaining Cross-Repo Clarifications

1. Compatibility:
   - Phase 1 keeps accepting `browser-playwright-cli` as an alias for
     `browser`.
   - Do not define an alias expiration date or removal release in this plan.
     Revisit only after Team9, aHand, and agent-pi have all shipped the stable
     `browser` capability path.

2. aHand release tag:
   - The exact `ahandd` tag Team9 should pin is the only remaining value that
     cannot be determined in this document. It depends on aHand publishing a
     build that includes CDP/provider status support.

### Fixed Cross-Repo Phase-1 Contracts

1. aHand flat `BrowserConfig` field names:
   - `selected_provider`
   - `cdp_enabled`
   - `cdp_mode`
   - `cdp_endpoint`
   - `playwright_enabled`

2. Raw aHand/Tauri local provider-status response:

```ts
{
  browserProviders: Array<"cdp" | "playwright">;
}
```

3. Team9 effective local provider state:

```ts
{
  browserProviders: Array<"cdp" | "playwright">;
  selectedProvider?: "cdp" | "playwright";
}
```

4. agent-pi generic browser tools:
   - agent-pi may expose generic model-facing tool names, but it must not
     create new `BrowserRequest.action` names for phase 1.
   - agent-pi should add a provider-agnostic browser skill that documents these
     generic tools. The skill is instruction-only; the callable surface is the
     registered browser tools.
   - The browser skill must not mention `playwright-cli` as the execution
     mechanism and must not ask the model to choose `cdp` or `playwright`.
   - `browser_navigate` sends `BrowserRequest.action = "open"`.
   - `browser_click` sends `BrowserRequest.action = "click"`.
   - `browser_type` sends `BrowserRequest.action = "fill"` when a selector/ref
     is provided, or `BrowserRequest.action = "type"` when typing into the
     focused element.
   - `browser_evaluate` sends `BrowserRequest.action = "eval"`.
   - `browser_wait_for` sends `BrowserRequest.action = "wait"`; aHand should
     expose the existing OpenClaw wait behavior through BrowserRequest for this.
   - `browser_screenshot` is deferred from this discussion. Phase 1 can proceed
     with navigation/click/type/evaluate/wait and existing non-screenshot result
     handling.

5. agent-pi tool result metadata:

This metadata is for Team9/internal event display and diagnostics. It is not
part of the model-facing browser tool input schema, and the model does not
provide the `provider` value.

```ts
{
  provider?: "cdp" | "playwright";
  action: string;
  status: "success" | "error";
  url?: string;
  title?: string;
  text?: string;
  error?: string;
}
```

## Immediate Next Steps

1. Share this plan with aHand and agent-pi so they can implement the fixed
   phase-1 contracts above.
2. Team9 implements local per-user/per-device browser provider settings and
   local fallback when the selected provider is unavailable on the current
   device.
3. Team9 implements im-worker capability and selected-provider passthrough.
4. aHand publishes an `ahandd` build that reports local browser provider status
   to the Team9 desktop UI and executes Playwright and CDP providers separately.
5. agent-pi exposes generic browser tools when `browser` is present and routes
   calls through aHand without exposing provider details to the model.

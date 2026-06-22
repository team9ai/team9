# Team9 Local Browser/CDP Do And Don't Plan

Date: 2026-06-04

## Purpose

This document defines Team9's implementation boundary for the local browser/CDP
phase. It is intentionally narrower than the cross-repository CDP plan: this
file records what Team9 owns, what Team9 must not own, and which external
contracts Team9 consumes from aHand and agent-pi.

## Team9 Scope

Team9's job is to make the local browser provider choice visible, selectable,
and available to the agent session through existing Team9 plumbing.

Team9 does not implement browser automation. Browser execution remains behind
aHand and agent-pi.

## Team9 Do

### Client/Tauri

- Reuse the existing browser runtime setup surface:
  - `browser_status`
  - `browser_install`
  - `browser_set_enabled`
- Extend local browser status consumption to read raw provider availability:

```ts
{
  browserProviders: Array<"cdp" | "playwright">;
}
```

- Treat `browserProviders` as local aHand/Tauri runtime state only.
- Store the user-selected browser provider locally in the existing persisted
  `useAhandStore` per-user aHand state.
- Scope selected provider by user/device. Do not assume the same provider is
  available after switching devices.
- Compute the effective provider in Team9 client from:
  - raw local `browserProviders`;
  - locally stored `browser.selectedProvider`;
  - local fallback rules.
- If both `cdp` and `playwright` are available and no prior local selection
  exists, default to `cdp`.
- If the stored selection is unavailable on the current device, select an
  available local provider and do not show the unavailable provider as a
  selectable option.
- Keep the UI inside the existing local device/browser setup surface.
- Clearly state in the CDP option that CDP uses the user's local Chrome
  profile/session/cookie state.

Recommended local state extension:

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

### Client Message Context

- Reuse the existing message `clientContext` path.
- Extend Team9 client context with optional browser provider selection:

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

- Update `buildClientContext()` to read the selected provider from
  `useAhandStore` for the current user/device.
- Send the selected provider only when Team9 has an effective local provider.

### Gateway

- Keep using the existing top-level `clientContext` merge into
  `messages.metadata.clientContext`.
- Extend `ClientContextDto` to allow optional nested
  `browser.selectedProvider`.
- Keep persisting aHand device `capabilities` as already implemented.
- Expose `capabilities` in public `DeviceDto` only if the client UI needs to
  display them.
- Preserve existing webhook semantics:
  - `device.online` capabilities are authoritative;
  - `device.registered` with empty capabilities must not wipe a later online
    capabilities value.

### im-worker

- Extend the aHand control-plane device schema to parse:

```ts
capabilities: z.array(z.string()).default([]);
```

- Pass capabilities into `ahand-host.config`.
- Extend im-worker `ClientContextRaw` to read optional
  `browser.selectedProvider`.
- Pass Team9's selected provider into `ahand-host.config.browser`.

Expected `ahand-host.config` shape from Team9:

```ts
{
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

### Compatibility

- Treat `browser` as the stable capability.
- Accept `browser-playwright-cli` as a legacy alias for `browser` while other
  services roll out.
- Do not define alias expiration timing in Team9.
- Do not infer provider availability from `browser-playwright-cli` or other
  provider-specific aliases.

## Team9 Don't Do

### Do Not Own Browser Execution

- Do not connect the React client directly to a Chrome CDP websocket.
- Do not implement CDP command execution in Team9.
- Do not implement Playwright execution in Team9.
- Do not create a Team9-native local job protocol parallel to aHand.
- Do not route all Team9 agent traffic through aHand.

### Do Not Own Provider Availability

- Do not persist `browserProviders` in Team9 Gateway or database.
- Do not add `browserProviders` to Gateway DTOs in phase 1.
- Do not infer provider availability from `capabilities`.
- Do not infer provider availability from legacy aliases such as
  `browser-playwright-cli`.
- Do not expose server-side provider availability or remote-device provider
  selection in phase 1.

### Do Not Own Provider Execution Policy

- Do not let agent-pi or Team9 silently rewrite `cdp` to `playwright` after a
  browser job has been created.
- Do not hot-update an already running agent-pi session when local provider
  availability changes.
- Do not make Team9 responsible for aHand's final provider validation.
- Do not make Team9 responsible for Chrome launch, remote-debugging port
  allocation, profile lock handling, target tracking, or attach-vs-launched
  lifecycle behavior.

### Do Not Expose Provider Choice To The Model

- Do not add model-facing tool schema fields that ask the model to choose
  `cdp` or `playwright`.
- Do not expose provider-specific browser tools in Team9.
- Do not register the old `browser-playwright-cli` skill as a model-facing
  surface from Team9.

### Do Not Define External Action Contracts

- Do not define or fork `BrowserRequest.action` names in Team9.
- Do not define the mapping from agent-pi generic browser tools to
  Playwright-compatible `BrowserRequest.action` values in Team9.
- Leave the action mapping to agent-pi/aHand, using their existing browser
  action contract.

### Do Not Add Out-Of-Scope UX

- Do not expose manual Chrome path/profile selection in phase 1.
- Do not expose manual CDP endpoint entry in the Team9 UI in phase 1.
- Do not add a separate confirmation dialog for CDP in phase 1.
- Do not support arbitrary active-tab control in phase 1.
- Do not add screenshot-specific artifact behavior in phase 1.

## External Contracts Team9 Consumes

### From aHand

Team9 expects aHand/Tauri local browser status to provide raw availability:

```ts
{
  browserProviders: Array<"cdp" | "playwright">;
}
```

Team9 expects aHand to own:

- provider readiness;
- CDP provider execution;
- Playwright provider execution;
- Chrome profile/session/cookie reuse;
- Chrome process and remote-debugging lifecycle;
- provider-unavailable and CDP failure errors through existing aHand job/browser
  response fields.

Team9 will pin a new `ahandd` tag after aHand publishes one with CDP/provider
status support.

### From agent-pi

Team9 expects agent-pi to:

- consume `ahand-host.config.capabilities`;
- consume `ahand-host.config.browser.selectedProvider`;
- register provider-agnostic generic browser tools when `browser` is present;
- pass Team9's selected provider through to aHand jobs;
- keep provider choice out of the model-facing tool schema;
- map generic browser tools to the existing Playwright-compatible
  `BrowserRequest.action` contract.

Team9 does not define that action mapping.

## Implementation Order For Team9

1. Extend local aHand/browser state in `useAhandStore` with
   `browser.selectedProvider`.
2. Extend Tauri browser status consumption to read `browserProviders`.
3. Update browser setup UI to show available providers and local selection.
4. Update `buildClientContext()` to include `browser.selectedProvider`.
5. Extend Gateway `ClientContextDto` to preserve nested
   `browser.selectedProvider`.
6. Extend im-worker device parsing to include `capabilities`.
7. Extend im-worker `ClientContextRaw` and `AhandBlueprintExtender` to pass
   capabilities and selected provider into `ahand-host.config`.
8. Add focused tests for client context, Gateway DTO preservation, im-worker
   config injection, and provider availability not crossing server boundaries.
9. Update Team9's pinned `ahandd` tag after aHand publishes the required build.

## Team9 Tests

- Client:
  - raw `browserProviders` are read from local browser status;
  - selected provider is stored locally per user/device;
  - unavailable providers are not selectable;
  - fallback picks an available local provider before a message/session is
    created;
  - `buildClientContext()` includes `browser.selectedProvider` for macapp
    contexts when available.
- Gateway:
  - `ClientContextDto` accepts optional nested `browser.selectedProvider`;
  - existing metadata merge preserves `browser.selectedProvider`;
  - `browserProviders` is not persisted or exposed by Gateway.
- im-worker:
  - aHand device schema parses `capabilities`;
  - missing capabilities default to `[]`;
  - `AhandBlueprintExtender` injects capabilities and selected provider into
    `ahand-host.config`.

## Completion Criteria

- Team9 can show a local provider selector based on aHand-reported availability.
- Team9 stores selected provider locally per user/device.
- Team9 sends selected provider through existing `clientContext` and
  `ahand-host.config` paths.
- Team9 never persists provider availability server-side.
- Team9 does not implement or define browser execution behavior owned by
  aHand/agent-pi.

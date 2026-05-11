# Base-Model Agent Family-Internal Model Switching

**Date:** 2026-05-11
**Status:** Draft

## Problem

The dashboard composer and the chat InputView both expose a model picker for
AI agents, but for the three `base-model-staff` agents (Claude / ChatGPT /
Gemini) the picker is read-only on both surfaces. Users can see e.g.
"GPT-5.4 Mini" on the ChatGPT agent but cannot switch to "GPT-5.4". This is
inconsistent with Common Staff / Personal Staff agents, which already support
free-form model switching across all nine `COMMON_STAFF_MODELS`.

Goal: let users pick any model **within the agent's own family** on both
surfaces, with the dashboard's choice applied to the next topic session only
(session-scoped, never persisted to the bot's default).

## Non-goals

- Cross-family switching for base-model agents (a Claude agent should not be
  switchable to GPT-5.4 — that defeats the purpose of having a Claude agent).
- Persisting base-model agent defaults to bot config. The dashboard's model
  choice is a per-session override, identical to today's Common Staff
  behavior.
- Changing Common Staff / Personal Staff behavior. They keep the full
  nine-model list.

## Backend status: ready, no changes needed

| Endpoint                                                                                                                         | Status |
| -------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `POST /v1/im/topic-sessions` accepts `model` field and forwards to agent-pi as `sessionInitial`                                  | ✅     |
| `PATCH /v1/im/channels/:id/model` accepts any hive-managed bot (incl. base-model-staff) and forwards as `session.model_override` | ✅     |
| agent-pi resolves `agentDefault → sessionInitial → sessionDynamic`                                                               | ✅     |
| `managedMeta.agentId` contains `-claude-` / `-chatgpt-` / `-gemini-` for family detection                                        | ✅     |

See [topic-sessions.service.ts:165](apps/server/apps/gateway/src/im/topic-sessions/topic-sessions.service.ts#L165),
[channel-model.controller.ts:136](apps/server/apps/gateway/src/im/channels/channel-model.controller.ts#L136),
[claw-hive.service.ts:196-211](apps/server/libs/claw-hive/src/claw-hive.service.ts#L196-L211),
[base-model-staff.handler.ts:92-94](apps/server/apps/gateway/src/applications/handlers/base-model-staff.handler.ts#L92-L94).

## Frontend changes

### 1. `useDashboardAgents.ts`

- Add `agentModelFamily: StaffModelFamily | null` to the `DashboardAgent`
  interface.
- For `applicationId === "base-model-staff"` bots, derive family via the
  same logic used in `useBotModelSwitch`:
  `BASE_MODEL_PRODUCT_FAMILY[getBaseModelProductKey(bot.managedMeta?.agentId)]`.
- Update `canSwitchDashboardModel` to return `true` for base-model-staff
  bots **only when `agentModelFamily !== null`** (defensive: an
  unrecognized base-model bot stays read-only).

### 2. `HomeMainContent.tsx` — `DashboardModelControl`

- Accept new prop `agentModelFamily?: StaffModelFamily | null`.
- In the dropdown body, filter
  `COMMON_STAFF_MODELS.filter(m => !agentModelFamily || m.family === agentModelFamily)`.
- `getAgentModelLabel`: when `sessionModelOverride === null` and the agent
  is base-model with a recognized family, show the family's default label
  (use existing `FIXED_BASE_MODEL_LABELS` — already correct for the three
  presets).
- The existing effect that resets `sessionModelOverride` on agent switch
  ([HomeMainContent.tsx:530-532](apps/client/src/components/layout/contents/HomeMainContent.tsx#L530-L532))
  already handles cross-family transitions; no change.

### 3. Chat InputView — verification only

`ChannelView` already prefers `channelModelSwitch`
([ChannelView.tsx:722-723](apps/client/src/components/channel/ChannelView.tsx#L722-L723)),
which exposes `canSwitchModel: true` regardless of the bot's application
type and reuses `agentModelFamily` from `useBotModelSwitch`
([ChannelView.tsx:344-348](apps/client/src/components/channel/ChannelView.tsx#L344-L348)).
`RichTextEditor`'s existing family-aware filter
([RichTextEditor.tsx:565-568](apps/client/src/components/channel/editor/RichTextEditor.tsx#L565-L568))
will then naturally show only the right models. Update path is
`channelModel.updateModel` → PATCH `/v1/im/channels/:id/model`, which is
already supported server-side.

Plan: verify end-to-end, do not modify code.

### 4. `useBotModelSwitch.ts` — leave as-is

Keep `canSwitchModel = false` for base-model-staff. Reason: it is only the
fallback when `channelModel` errors. Showing a dropdown that would call an
unimplemented `updateModel` path is worse UX than hiding the picker.

## Testing

**New unit tests**

- `useDashboardAgents.test`: a base-model-staff bot with
  `managedMeta.agentId = 'base-model-claude-…'` produces
  `agentModelFamily: 'anthropic'` and `canSwitchModel: true`. A
  base-model-staff bot with an unrecognized agentId produces
  `agentModelFamily: null` and `canSwitchModel: false`.
- `HomeMainContent.test`: switching to a Claude / ChatGPT / Gemini agent
  shows only that family's models in the dropdown; switching to a
  Common-Staff agent still shows all nine.

**Manual end-to-end**

1. Dashboard → select ChatGPT agent → dropdown shows only GPT-5.4 and
   GPT-5.4 Mini → pick GPT-5.4 → send first message.
2. Enter the resulting channel → InputView shows "GPT-5.4" as current.
3. InputView → pick GPT-5.4 Mini → next reply uses Mini (verify via
   gateway log of `session.model_override` to agent-pi).
4. Back to dashboard → switch to Claude agent → dropdown now shows only
   the two Claude models, override is cleared.

## Edge cases

- **Cross-family agent switch:** existing effect clears
  `sessionModelOverride` on `selectedAgentUserId` change — verified to
  cover this in the manual test step 4.
- **Unrecognized base-model bot:** `agentModelFamily === null` →
  `canSwitchModel = false` → falls back to the read-only pill with the
  hardcoded `FIXED_BASE_MODEL_LABELS` label (current behavior, no
  regression).
- **`channelModel` GET fails mid-session:** dropdown disappears because
  the `botModelSwitch` fallback has `canSwitchModel: false` for
  base-model agents. Acceptable — user retries when the channel is
  healthy.

## Out of scope follow-ups (not part of this work)

- Unifying the two pickers into a single shared `<ModelSelector>`
  component.
- Filtering Common Staff / Personal Staff models by family (current
  behavior intentionally permits cross-family choice for non-base-model
  agents).

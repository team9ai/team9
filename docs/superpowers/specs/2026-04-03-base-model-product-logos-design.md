# Base Model Product Logos Design

## Summary

Replace the placeholder emoji currently used for `base-model-staff` assistants in the AI assistants list with product logos for Claude, ChatGPT, and Gemini.

This change is intentionally narrow:

- only the `base-model-staff` assistants list is updated
- logos are sourced from local assets, not remote URLs
- unknown or unmapped agents still fall back to the existing generic bot icon

This design does not change chat message avatars, mention suggestions, sidebar user lists, or any other generic bot avatar surface.

## Goals

- Show a recognizable product logo for Claude, ChatGPT, and Gemini in the `BaseModelStaffBotsTab` assistant cards.
- Centralize the `agentId -> product key -> logo` mapping in one reusable client-side utility/component.
- Keep the current UI structure, status badges, and data-fetching behavior unchanged.
- Preserve a safe fallback for unknown or future base-model agent IDs.

## Non-Goals

- No changes to IM user payloads or generic `UserAvatar` behavior.
- No changes to OpenClaw bot rendering.
- No remote logo fetching or runtime dependency on external brand asset URLs.
- No broader branding refresh across the desktop app.

## Current State

`apps/client/src/components/applications/config-panels/BaseModelStaffConfigPanel.tsx` parses `managedMeta.agentId` and maps known agent keys to a provider name plus a colored emoji marker.

The current card avatar surface is a square container that renders:

- an emoji for known `claude`, `chatgpt`, and `gemini` keys
- a `lucide-react` `Bot` icon for unknown keys

This works functionally but does not match the requested product-brand presentation.

## Proposed Design

### 1. Local logo assets

Add one local SVG asset per supported product under `apps/client/src/assets/base-model/`:

- `claude.svg`
- `chatgpt.svg`
- `gemini.svg`

These assets are imported by the client bundle so rendering stays offline-safe and deterministic.

### 2. Centralized model-key parsing

Move the `agentId` parsing logic out of the config panel into a focused utility module. The utility will:

- inspect `managedMeta.agentId`
- detect `claude`, `chatgpt`, or `gemini`
- return a normalized product key
- return `null` for unknown values

The parsing rule remains based on the existing `base-model-{key}-{tenantShort}` format, so this change does not require backend updates.

### 3. Reusable logo component

Create a small UI component that accepts an optional `agentId` and renders:

- the matching product SVG for Claude, ChatGPT, or Gemini
- a generic `Bot` icon fallback when no known key can be resolved

The component owns the square avatar container styling currently embedded in the config panel, so the panel stays focused on layout and data display.

### 4. Scope of replacement

Update `BaseModelStaffConfigPanel.tsx` to replace the current emoji rendering with the new logo component.

The provider text label (`Anthropic`, `OpenAI`, `Google`) remains unchanged because it is still useful supporting metadata beside the display name.

No other surfaces are updated in this task, even if they currently show `/bot.webp`, because they do not consistently receive `managedMeta.agentId`.

## Error Handling And Fallbacks

- If `managedMeta.agentId` is missing, render the generic `Bot` icon.
- If `managedMeta.agentId` does not match a known key, render the generic `Bot` icon.
- If a local SVG import fails during development, the build/test failure is preferable to silently loading a remote asset.

## Testing Strategy

Add a focused component test that covers:

- `claude` agent IDs render the Claude product logo
- `chatgpt` agent IDs render the ChatGPT product logo
- `gemini` agent IDs render the Gemini product logo
- unknown agent IDs render the generic fallback icon

Update or preserve any existing tests that depend on the config panel structure only if the DOM assertions need to reflect the new avatar content.

## Implementation Notes

- Keep the change client-only.
- Do not add a new icon package dependency for this task.
- Prefer SVG imports plus a lightweight wrapper component over inline page-specific markup.
- Keep the fallback path explicit so future model additions fail gracefully until mapped.

# Base-Model Agent Family-Internal Model Switching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users pick any model within the agent's own family on the dashboard composer for `base-model-staff` agents (Claude / ChatGPT / Gemini). Chat InputView gains the same capability automatically because `ChannelView` already routes through `channelModelSwitch` for any hive-managed bot — no code change there, verification only.

**Architecture:** Two surgical frontend edits. (1) `useDashboardAgents` derives a per-agent `agentModelFamily` from `managedMeta.agentId` and opens `canSwitchModel` for recognized base-model bots. (2) `DashboardModelControl` filters the dropdown by family. Backend (`POST /v1/im/topic-sessions` model field + `PATCH /v1/im/channels/:id/model`) is already in place; agent-pi already resolves `agentDefault → sessionInitial → sessionDynamic`.

**Tech Stack:** TypeScript, React, Vitest, Testing Library.

**Spec:** [docs/superpowers/specs/2026-05-11-base-model-family-switching-design.md](../specs/2026-05-11-base-model-family-switching-design.md)

---

## File Map

| File                                                                            | Action | Responsibility                                                                                                                                             |
| ------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/client/src/hooks/useDashboardAgents.ts`                                   | Modify | Add `agentModelFamily` field; compute family for base-model bots; allow `canSwitchModel` when family is resolved.                                          |
| `apps/client/src/hooks/__tests__/useDashboardAgents.test.ts`                    | Modify | Cover family detection + canSwitch behavior for base-model bots.                                                                                           |
| `apps/client/src/components/layout/contents/HomeMainContent.tsx`                | Modify | `DashboardModelControl` reads `agent.agentModelFamily` and filters `COMMON_STAFF_MODELS`.                                                                  |
| `apps/client/src/components/layout/contents/__tests__/HomeMainContent.test.tsx` | Modify | Update mocks for the new `agentModelFamily` field; cover the family-filtered dropdown; keep the read-only path covered via an unrecognized base-model bot. |

No backend changes. No new files.

---

## Task 1: Add `agentModelFamily` and Open `canSwitchModel` for Recognized Base-Model Bots

**Files:**

- Modify: `apps/client/src/hooks/useDashboardAgents.ts`
- Modify: `apps/client/src/hooks/__tests__/useDashboardAgents.test.ts`

- [ ] **Step 1.1: Add the two failing unit tests**

Append at the bottom of `apps/client/src/hooks/__tests__/useDashboardAgents.test.ts`, inside the existing `describe("buildDashboardAgents", ...)` block:

```typescript
it("computes anthropic agentModelFamily and enables switching for a Claude base-model bot", () => {
  const installedApps = [
    makeInstalledApp({
      id: "base-app",
      applicationId: "base-model-staff",
      name: "Base Model Staff",
      bots: [
        {
          botId: "bot-claude",
          userId: "bot-user-claude",
          username: "claude_bot",
          displayName: "Claude",
          avatarUrl: null,
          isActive: true,
          createdAt: "2026-05-11T00:00:00.000Z",
          managedMeta: { agentId: "base-model-claude-tenant-1" },
        },
      ],
    }),
  ] as InstalledApplicationWithBots[];

  const agents = buildDashboardAgents(installedApps, [], "me");

  expect(agents).toHaveLength(1);
  expect(agents[0]).toMatchObject({
    applicationId: "base-model-staff",
    agentModelFamily: "anthropic",
    canSwitchModel: true,
  });
});

it("computes openai agentModelFamily for a ChatGPT base-model bot", () => {
  const installedApps = [
    makeInstalledApp({
      id: "base-app",
      applicationId: "base-model-staff",
      name: "Base Model Staff",
      bots: [
        {
          botId: "bot-gpt",
          userId: "bot-user-gpt",
          username: "chatgpt_bot",
          displayName: "ChatGPT",
          avatarUrl: null,
          isActive: true,
          createdAt: "2026-05-11T00:00:00.000Z",
          managedMeta: { agentId: "base-model-chatgpt-tenant-1" },
        },
      ],
    }),
  ] as InstalledApplicationWithBots[];

  const agents = buildDashboardAgents(installedApps, [], "me");

  expect(agents[0]).toMatchObject({
    agentModelFamily: "openai",
    canSwitchModel: true,
  });
});

it("keeps base-model bots read-only when the family cannot be resolved", () => {
  const installedApps = [
    makeInstalledApp({
      id: "base-app",
      applicationId: "base-model-staff",
      name: "Base Model Staff",
      bots: [
        {
          botId: "bot-mystery",
          userId: "bot-user-mystery",
          username: "mystery_bot",
          displayName: "Mystery",
          avatarUrl: null,
          isActive: true,
          createdAt: "2026-05-11T00:00:00.000Z",
          managedMeta: { agentId: "base-model-mystery-tenant-1" },
        },
      ],
    }),
  ] as InstalledApplicationWithBots[];

  const agents = buildDashboardAgents(installedApps, [], "me");

  expect(agents[0]).toMatchObject({
    agentModelFamily: null,
    canSwitchModel: false,
  });
});

it("leaves common-staff agents with a null agentModelFamily so all models stay selectable", () => {
  const installedApps = [
    makeInstalledApp({
      id: "common-app",
      applicationId: "common-staff",
      name: "Common Staff",
      bots: [
        {
          botId: "bot-common",
          userId: "bot-user-common",
          username: "common_staff",
          displayName: "Common Staff",
          roleTitle: null,
          shortRoleTitle: null,
          persona: null,
          jobDescription: null,
          avatarUrl: null,
          model: null,
          mentorId: null,
          mentorDisplayName: null,
          mentorAvatarUrl: null,
          isActive: true,
          createdAt: "2026-05-11T00:00:00.000Z",
          managedMeta: { agentId: "common-1" },
        },
      ],
    }),
  ] as InstalledApplicationWithBots[];

  const agents = buildDashboardAgents(installedApps, [], "me");

  expect(agents[0]).toMatchObject({
    applicationId: "common-staff",
    agentModelFamily: null,
    canSwitchModel: true,
  });
});
```

- [ ] **Step 1.2: Run the new tests and verify they fail**

Run:

```bash
pnpm --filter @team9/client test -- --run apps/client/src/hooks/__tests__/useDashboardAgents.test.ts
```

Expected output: the four new tests fail because `agentModelFamily` is not yet present on `DashboardAgent` (`expect(received).toMatchObject(expected)` — actual has no `agentModelFamily` key, or `canSwitchModel` is `false` for the Claude/ChatGPT cases). The original `buildDashboardAgents` test should still pass.

- [ ] **Step 1.3: Update `useDashboardAgents.ts`**

In `apps/client/src/hooks/useDashboardAgents.ts`:

(a) Add imports at the top (after the existing import of `useCurrentUser`):

```typescript
import type { StaffModelFamily } from "@/lib/common-staff-models";
import {
  BASE_MODEL_PRODUCT_FAMILY,
  getBaseModelProductKey,
} from "@/lib/base-model-agent";
```

(b) Extend the `DashboardAgent` interface — append the new field after `canSwitchModel`:

```typescript
export interface DashboardAgent {
  userId: string;
  botId?: string;
  channelId?: string;
  label: string;
  username?: string;
  avatarUrl?: string | null;
  agentType: AgentType | null;
  applicationId: string;
  installedApplicationId?: string;
  hasExistingChannel: boolean;
  model: DashboardAgentModel | null;
  managedAgentId: string | null;
  canSwitchModel: boolean;
  // Non-null only for base-model agents whose `managedMeta.agentId` matches a
  // known preset (claude/chatgpt/gemini). Picker UIs lock the dropdown to a
  // single family using this. `null` means no filter — common/personal staff
  // can pick any model.
  agentModelFamily: StaffModelFamily | null;
  staffKind: "common" | "personal" | "other" | null;
  roleTitle: string | null;
  shortRoleTitle: string | null;
  ownerName: string | null;
}
```

(c) Add a helper above `canSwitchDashboardModel`:

```typescript
function getDashboardAgentFamily(
  applicationId: string,
  bot: DashboardBot,
): StaffModelFamily | null {
  if (applicationId !== "base-model-staff") return null;
  const agentId =
    "managedMeta" in bot ? (bot.managedMeta?.agentId ?? null) : null;
  const productKey = getBaseModelProductKey(agentId);
  return productKey ? BASE_MODEL_PRODUCT_FAMILY[productKey] : null;
}
```

(d) Replace `canSwitchDashboardModel` with the family-aware version:

```typescript
function canSwitchDashboardModel(
  applicationId: string,
  agentModelFamily: StaffModelFamily | null,
): boolean {
  if (applicationId === "common-staff" || applicationId === "personal-staff") {
    return true;
  }
  if (applicationId === "base-model-staff") {
    return agentModelFamily !== null;
  }
  return false;
}
```

(e) Inside `buildDashboardAgents`, replace the existing `agents.set(bot.userId, { ... })` call so it computes and stores the family. Find this block (currently around lines 148–169):

```typescript
agents.set(bot.userId, {
  userId: bot.userId,
  botId: bot.botId,
  channelId: existingChannel?.id,
  label,
  username: bot.username,
  avatarUrl: getBotAvatarUrl(bot) ?? existingChannel?.otherUser?.avatarUrl,
  agentType:
    getBotAgentType(bot) ?? existingChannel?.otherUser?.agentType ?? null,
  applicationId: app.applicationId,
  installedApplicationId: app.id,
  hasExistingChannel: !!existingChannel,
  model: getBotModel(bot),
  managedAgentId: getBotManagedAgentId(bot),
  canSwitchModel: canSwitchDashboardModel(app.applicationId),
  staffKind,
  roleTitle:
    getBotRoleTitle(bot) ?? existingChannel?.otherUser?.roleTitle ?? null,
  shortRoleTitle: getBotShortRoleTitle(bot),
  ownerName,
});
```

Replace with (note the new `agentModelFamily` computation pulled above the `agents.set` call, and the updated `canSwitchModel` call):

```typescript
const agentModelFamily = getDashboardAgentFamily(app.applicationId, bot);

agents.set(bot.userId, {
  userId: bot.userId,
  botId: bot.botId,
  channelId: existingChannel?.id,
  label,
  username: bot.username,
  avatarUrl: getBotAvatarUrl(bot) ?? existingChannel?.otherUser?.avatarUrl,
  agentType:
    getBotAgentType(bot) ?? existingChannel?.otherUser?.agentType ?? null,
  applicationId: app.applicationId,
  installedApplicationId: app.id,
  hasExistingChannel: !!existingChannel,
  model: getBotModel(bot),
  managedAgentId: getBotManagedAgentId(bot),
  canSwitchModel: canSwitchDashboardModel(app.applicationId, agentModelFamily),
  agentModelFamily,
  staffKind,
  roleTitle:
    getBotRoleTitle(bot) ?? existingChannel?.otherUser?.roleTitle ?? null,
  shortRoleTitle: getBotShortRoleTitle(bot),
  ownerName,
});
```

(f) Update the second `agents.set` for the `directBotChannels` fallback block (currently around lines 178–195) — add `agentModelFamily: null` after `canSwitchModel: false`:

```typescript
agents.set(otherUser.id, {
  userId: otherUser.id,
  channelId: channel.id,
  label: otherUser.displayName || otherUser.username || "AI Staff",
  username: otherUser.username,
  avatarUrl: otherUser.avatarUrl,
  agentType: otherUser.agentType ?? null,
  applicationId: "direct-channel",
  installedApplicationId: undefined,
  hasExistingChannel: true,
  model: null,
  managedAgentId: null,
  canSwitchModel: false,
  agentModelFamily: null,
  staffKind: otherUser.staffKind ?? null,
  roleTitle: otherUser.roleTitle ?? null,
  shortRoleTitle: null,
  ownerName: otherUser.ownerName ?? null,
});
```

- [ ] **Step 1.4: Run the targeted tests and verify they pass**

Run:

```bash
pnpm --filter @team9/client test -- --run apps/client/src/hooks/__tests__/useDashboardAgents.test.ts
```

Expected output: all five tests pass (the original `buildDashboardAgents` test plus the four new ones).

- [ ] **Step 1.5: Run the client typecheck to catch consumers of `DashboardAgent`**

Run:

```bash
pnpm --filter @team9/client typecheck
```

Expected output: the typecheck will likely flag `HomeMainContent.test.tsx` mocks that omit the new `agentModelFamily` field — that's expected and is fixed in Task 2. **Read the output carefully:** the only errors should be missing `agentModelFamily` in `mockUseDashboardAgents.mockReturnValue(...)` calls inside the HomeMainContent test (and any other test using the same shape). If you see errors anywhere else, stop and investigate before continuing.

- [ ] **Step 1.6: Commit**

```bash
git add apps/client/src/hooks/useDashboardAgents.ts apps/client/src/hooks/__tests__/useDashboardAgents.test.ts
git commit -m "feat(dashboard): derive agentModelFamily for base-model agents

Compute family ('anthropic' | 'openai' | 'google') from managedMeta.agentId
for base-model-staff bots and enable canSwitchModel when a family is
resolved. Common/personal staff are unaffected (family stays null, full
COMMON_STAFF_MODELS list remains selectable)."
```

---

## Task 2: Family-Filter the Dashboard Model Dropdown

**Files:**

- Modify: `apps/client/src/components/layout/contents/HomeMainContent.tsx`
- Modify: `apps/client/src/components/layout/contents/__tests__/HomeMainContent.test.tsx`

- [ ] **Step 2.1: Patch existing mocks in `HomeMainContent.test.tsx` to include `agentModelFamily`**

Open `apps/client/src/components/layout/contents/__tests__/HomeMainContent.test.tsx`. Six `mockUseDashboardAgents.mockReturnValue(...)` blocks reference agents in this file. Find each agent object and add `agentModelFamily: null` after the `canSwitchModel` field. Specifically:

- In `beforeEach` (the two common-staff agents — Alpha Agent at ~line 137 and Beta Agent at ~line 151), add `agentModelFamily: null` after `canSwitchModel: true`.
- In `"shows a static model label for base-model agents that cannot switch"` (~line 227), the existing Claude mock currently has `canSwitchModel: false` with `managedAgentId: "base-model-claude-ws-1"`. We are intentionally rewriting this test in Step 2.2 — leave this block alone for now (Step 2.2 replaces it wholesale).
- In `"defaults to the personal-staff agent when one exists"` (~line 260), both agent objects need `agentModelFamily: null` appended after `canSwitchModel`.

After this step, no behavior changes — only field additions for type-checking.

- [ ] **Step 2.2: Rewrite the existing "static label" test for an unrecognized base-model bot**

In `HomeMainContent.test.tsx`, locate the test currently titled `"shows a static model label for base-model agents that cannot switch"`. Replace its body so the bot has an unrecognized agentId (still read-only, validates the defensive fallback). Replace the entire `it(...)` block with:

```typescript
  it("shows a static model label for unrecognized base-model agents that cannot switch", () => {
    mockUseDashboardAgents.mockReturnValue({
      agents: [
        {
          userId: "base-agent-mystery",
          botId: "mystery-bot",
          channelId: "bot-ch-mystery",
          label: "Mystery",
          username: "mystery_bot",
          applicationId: "base-model-staff",
          installedApplicationId: "app-base",
          agentType: "base_model",
          hasExistingChannel: true,
          model: null,
          managedAgentId: "base-model-mystery-ws-1",
          canSwitchModel: false,
          agentModelFamily: null,
        },
      ],
    });

    renderWithProviders(<HomeMainContent />);

    // Fallback label from translation map for the read-only pill.
    expect(screen.getByText("GPT5.4")).toBeInTheDocument();
  });
```

(The previous expected text `"Claude Sonnet 4.6"` came from `FIXED_BASE_MODEL_LABELS.claude`. With the family resolved to `null`, `getAgentModelLabel` falls through to `fallbackLabel`, which is `t("dashboardModelLabel") = "GPT5.4"` per the translation map in this test file.)

- [ ] **Step 2.3: Add the new family-filtered dropdown test**

Append the following new test inside the `describe("HomeMainContent", ...)` block (e.g. directly after the rewritten test from Step 2.2):

```typescript
  it("shows only family-matching models in the picker for a recognized Claude base-model agent", async () => {
    mockUseDashboardAgents.mockReturnValue({
      agents: [
        {
          userId: "base-agent-claude",
          botId: "claude-bot",
          channelId: "bot-ch-claude",
          label: "Claude",
          username: "claude_bot",
          applicationId: "base-model-staff",
          installedApplicationId: "app-base",
          agentType: "base_model",
          hasExistingChannel: true,
          model: null,
          managedAgentId: "base-model-claude-ws-1",
          canSwitchModel: true,
          agentModelFamily: "anthropic",
        },
      ],
    });

    renderWithProviders(<HomeMainContent />);

    // The composer model trigger shows the family default label
    // (Claude Sonnet 4.6) because no override is selected yet.
    const trigger = screen.getByRole("button", { name: /claude sonnet 4\.6/i });
    fireEvent.pointerDown(trigger);

    // Both Anthropic models present
    expect(
      await screen.findByRole("menuitemradio", { name: /claude opus 4\.7/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitemradio", { name: /claude sonnet 4\.6/i }),
    ).toBeInTheDocument();

    // Non-Anthropic models filtered out
    expect(
      screen.queryByRole("menuitemradio", { name: /gpt-5\.4/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menuitemradio", { name: /gemini/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menuitemradio", { name: /qwen/i }),
    ).not.toBeInTheDocument();
  });
```

- [ ] **Step 2.4: Run the new + updated tests and verify they fail at the right step**

Run:

```bash
pnpm --filter @team9/client test -- --run apps/client/src/components/layout/contents/__tests__/HomeMainContent.test.tsx
```

Expected output:

- The "static label for unrecognized base-model agents" test passes already if `getAgentModelLabel`'s existing branch handles `agentModelFamily === null` via the fallback — verify by reading the actual output. If it fails, the failure must be `expected "GPT5.4"` actually returns one of the `FIXED_BASE_MODEL_LABELS` values; this is fine, Step 2.5 fixes it.
- The "shows only family-matching models" test fails because `DashboardModelControl` currently renders all nine `COMMON_STAFF_MODELS`, so non-Anthropic models will be found in the dropdown.

- [ ] **Step 2.5: Update `DashboardModelControl` and `getAgentModelLabel` in `HomeMainContent.tsx`**

Open `apps/client/src/components/layout/contents/HomeMainContent.tsx`.

(a) Add `StaffModelFamily` to the imports — change:

```typescript
import {
  COMMON_STAFF_MODELS,
  DEFAULT_STAFF_MODEL,
} from "@/lib/common-staff-models";
```

to:

```typescript
import {
  COMMON_STAFF_MODELS,
  DEFAULT_STAFF_MODEL,
  type StaffModelFamily,
} from "@/lib/common-staff-models";
```

(b) Update `getAgentModelLabel` to handle the unrecognized-family case before falling back to `FIXED_BASE_MODEL_LABELS`. Replace the existing function body with:

```typescript
function getAgentModelLabel(
  agent: DashboardAgent | null,
  model: DashboardAgentModel | null,
  fallbackLabel: string,
) {
  if (!agent) return fallbackLabel;

  if (model) {
    const matchedModel = COMMON_STAFF_MODELS.find(
      (candidate) =>
        candidate.provider === model.provider && candidate.id === model.id,
    );

    return matchedModel?.label ?? model.id;
  }

  if (agent.canSwitchModel && agent.agentModelFamily === null) {
    return DEFAULT_STAFF_MODEL.label;
  }

  const productKey =
    getBaseModelProductKey(agent.managedAgentId) ??
    getBaseModelProductKeyFromBotIdentity({
      isBot: true,
      name: agent.label,
      username: agent.username,
    });

  if (productKey) {
    return FIXED_BASE_MODEL_LABELS[productKey];
  }

  if (agent.canSwitchModel) {
    return DEFAULT_STAFF_MODEL.label;
  }

  return fallbackLabel;
}
```

The new ordering:

1. Model explicitly picked → its label.
2. Common/personal staff (`canSwitchModel: true`, `agentModelFamily: null`) → `DEFAULT_STAFF_MODEL.label`.
3. Known base-model bot → its family default from `FIXED_BASE_MODEL_LABELS` (regardless of `canSwitchModel`, this gives Claude/ChatGPT/Gemini their correct default when no override is set).
4. Switchable but unidentifiable → `DEFAULT_STAFF_MODEL.label`.
5. Last resort → the fallback string passed in.

(c) Update `DashboardModelControl` to filter by family. Replace the function body with:

```typescript
function DashboardModelControl({
  agent,
  model,
  fallbackLabel,
  onSelectModel,
}: {
  agent: DashboardAgent | null;
  model: DashboardAgentModel | null;
  fallbackLabel: string;
  onSelectModel: (model: DashboardAgentModel) => void;
}) {
  const currentLabel = getAgentModelLabel(agent, model, fallbackLabel);
  const currentValue = model ? `${model.provider}::${model.id}` : undefined;
  const agentModelFamily: StaffModelFamily | null =
    agent?.agentModelFamily ?? null;
  const availableModels = agentModelFamily
    ? COMMON_STAFF_MODELS.filter((m) => m.family === agentModelFamily)
    : COMMON_STAFF_MODELS;

  if (!agent?.canSwitchModel) {
    return (
      <div className="dashboard-composer-model inline-flex h-[2.05rem] items-center gap-1.5 rounded-full px-3 text-[0.76rem] text-[#50627f]">
        <Sparkles size={12} className="text-[#2c3647]" />
        <span>{currentLabel}</span>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="dashboard-composer-model inline-flex h-[2.05rem] items-center gap-1.5 rounded-full px-3 text-[0.76rem] text-[#50627f] cursor-pointer"
        >
          <Sparkles size={12} className="text-[#2c3647]" />
          <span>{currentLabel}</span>
          <ChevronDown size={11} className="text-[#93887b]" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        className="w-[15rem] rounded-3xl border-white/70 bg-white/95 p-2 shadow-[0_20px_50px_rgba(140,121,93,0.18)] backdrop-blur"
      >
        <DropdownMenuRadioGroup
          value={currentValue}
          onValueChange={(value) => {
            const [provider, id] = value.split("::");
            if (!provider || !id) return;
            onSelectModel({ provider, id });
          }}
        >
          {availableModels.map((model) => (
            <DropdownMenuRadioItem
              key={`${model.provider}::${model.id}`}
              value={`${model.provider}::${model.id}`}
              className="!cursor-pointer rounded-2xl py-2.5 pr-3"
            >
              {model.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

No change to the JSX usage at ~line 819 is needed — `agent.agentModelFamily` flows through the existing `agent={selectedAgent}` prop.

- [ ] **Step 2.6: Run the test file and verify both new tests pass**

Run:

```bash
pnpm --filter @team9/client test -- --run apps/client/src/components/layout/contents/__tests__/HomeMainContent.test.tsx
```

Expected output: all tests in this file pass, including:

- The original `"renders the dashboard with title and prompt input"`, `"creates a topic session..."`, and other previously-passing tests.
- `"shows a static model label for unrecognized base-model agents that cannot switch"` — passes because `agentModelFamily: null` + `canSwitchModel: false` falls through to the read-only branch, and `getAgentModelLabel` lands on `fallbackLabel`.
- `"shows only family-matching models in the picker for a recognized Claude base-model agent"` — passes.

- [ ] **Step 2.7: Run the full client typecheck**

Run:

```bash
pnpm --filter @team9/client typecheck
```

Expected output: clean (no errors).

- [ ] **Step 2.8: Commit**

```bash
git add apps/client/src/components/layout/contents/HomeMainContent.tsx apps/client/src/components/layout/contents/__tests__/HomeMainContent.test.tsx
git commit -m "feat(dashboard): family-filter model picker for base-model agents

DashboardModelControl now filters COMMON_STAFF_MODELS by
agent.agentModelFamily, restricting Claude/ChatGPT/Gemini agents to
their own model family while leaving common/personal staff unaffected.
Read-only fallback path is preserved for unrecognized base-model bots."
```

---

## Task 3: Full Client Test Suite & Typecheck

**Files:** none — verification only.

- [ ] **Step 3.1: Run the full client test suite**

Run:

```bash
pnpm --filter @team9/client test -- --run
```

Expected output: all tests pass. If any unrelated test fails on shape changes from the new `agentModelFamily` field, grep the source for `DashboardAgent` consumers that build the type by hand and add `agentModelFamily: null` (most likely candidates: `useAgentGroupsForSidebar.test.ts`, `useIMUsers.test.ts`). Add `agentModelFamily: null` to any failing mock. Re-run.

- [ ] **Step 3.2: Run client lint**

Run:

```bash
pnpm --filter @team9/client lint
```

Expected output: clean.

- [ ] **Step 3.3: Commit any test-mock cleanup that surfaced**

Only run if Step 3.1 surfaced additional mock fixes. Otherwise skip.

```bash
git add -A
git commit -m "test(client): extend dashboard agent mocks with agentModelFamily"
```

---

## Task 4: Manual End-to-End Verification

**Files:** none — interactive verification. **Do not commit anything during this task.**

- [ ] **Step 4.1: Start the dev stack**

In a separate terminal:

```bash
pnpm dev
```

Wait for both the gateway/im-worker server and the client Vite dev server to be ready (the client typically prints `Local: http://localhost:5173/`).

- [ ] **Step 4.2: Dashboard family filter — ChatGPT**

In the running client:

1. Log in to a workspace that has the `base-model-staff` app installed.
2. Open the dashboard (root route — same screen as the user's screenshot).
3. From the agent dropdown, pick the `ChatGPT` agent.
4. Click the model pill at the bottom of the composer. It should now be a clickable dropdown.

Expected: the dropdown shows exactly `GPT-5.4` and `GPT-5.4 Mini` — no Claude / Gemini / Qwen / GLM / Kimi entries.

If the dropdown shows all nine models, re-check `agentModelFamily` is propagating through `selectedAgent` — open devtools and inspect React state via the React DevTools extension, or temporarily `console.log(selectedAgent)` in `HomeMainContent.tsx` and reload.

- [ ] **Step 4.3: Dashboard family filter — Claude and Gemini**

Repeat Step 4.2 with the `Claude` agent (expect: only `Claude Opus 4.7`, `Claude Sonnet 4.6`) and the `Gemini` agent (expect: only `Gemini 3.1 Pro (Preview)`, `Gemini 3 Flash (Preview)`).

- [ ] **Step 4.4: Cross-family agent switch resets override**

1. Select the ChatGPT agent. Open the model dropdown. Pick `GPT-5.4` (not Mini).
2. Confirm the pill now reads `GPT-5.4`.
3. Switch the agent dropdown back to `Claude`.
4. Confirm the model pill resets to `Claude Sonnet 4.6` (the Claude family default) — the previously-selected `GPT-5.4` must not persist (it is in a different family and would be nonsensical here).

If `GPT-5.4` is still shown, the existing reset effect at `HomeMainContent.tsx:530-532` did not fire — verify the effect deps include `selectedAgentUserId`.

- [ ] **Step 4.5: Model override carries into the new topic session**

1. Select the ChatGPT agent on the dashboard. Pick `GPT-5.4` from the dropdown.
2. Type any message into the composer and press Enter.
3. The client navigates to a new channel. In the chat InputView, the model pill should display `GPT-5.4`.

Expected gateway-side log evidence (optional but ideal): the `createTopicSession` request body contains `model: { provider: "openrouter", id: "openai/gpt-5.4" }` and the agent-pi session is created with `sessionInitial` set.

- [ ] **Step 4.6: Chat InputView family filter (no-code-change verification)**

1. Inside the channel from Step 4.5, click the model pill in the chat InputView.
2. Confirm the dropdown shows exactly `GPT-5.4` and `GPT-5.4 Mini`.
3. Pick `GPT-5.4 Mini`. Send another message.
4. Confirm the pill now reads `GPT-5.4 Mini` and the reply is generated. (Optionally inspect the network tab for `PATCH /v1/im/channels/<id>/model` returning 200.)

This confirms `ChannelView` correctly routes through `channelModelSwitch` for base-model bots without any code change in the chat path.

- [ ] **Step 4.7: Negative path — verify common-staff agents still see the full list**

1. Switch the dashboard agent dropdown to any Common Staff or Personal Staff agent (e.g. `行业研究员`, `标的估值分析师`, or any personal assistant).
2. Open the model dropdown.

Expected: all nine `COMMON_STAFF_MODELS` are visible. This confirms the family filter does not over-apply.

---

## Self-Review Notes (already applied)

- **Spec coverage:** Spec sections 1 (`useDashboardAgents` changes), 2 (`HomeMainContent` changes), 3 (chat InputView verification only), 4 (`useBotModelSwitch` unchanged), Testing (new unit tests + manual E2E), and Edge cases (cross-family agent switch, unrecognized base-model bot, channelModel GET failure) all map to tasks above.
- **Placeholder scan:** No TBDs, no "add error handling," every code block is complete.
- **Type consistency:** `agentModelFamily: StaffModelFamily | null` is used identically in the `DashboardAgent` interface, the test mocks, the helper `getDashboardAgentFamily`, the updated `canSwitchDashboardModel(applicationId, agentModelFamily)`, and the `DashboardModelControl` prop access (`agent?.agentModelFamily ?? null`).

# Onboarding Subscription Step — Align with Paid Subscription Page

**Date:** 2026-04-12
**Status:** Draft

## Context

The onboarding flow's final step (`StepSix` in [onboarding.tsx](../../../apps/client/src/routes/_authenticated/onboarding.tsx)) renders its own custom subscription plan cards that diverge visually from the dedicated subscription page ([SubscriptionContent.tsx](../../../apps/client/src/components/layout/contents/SubscriptionContent.tsx)). The two surfaces sell the same plans but look different, creating inconsistency.

Goal: reuse the `PlanCard` UI from `SubscriptionContent.tsx` verbatim in onboarding `StepSix`, while keeping onboarding's CTA semantics. Free plan is **not** shown in onboarding.

## Scope

In scope:

- Extract `PlanCard` and its support helpers from `SubscriptionContent.tsx` into a shared module
- Rewrite `StepSix` plan card rendering to use the shared `PlanCard`
- 3-column grid, plan-grouping by product name, per-card billing cycle dropdown

Out of scope:

- Any backend changes
- Changing which products are offered
- Restyling other onboarding steps
- Changes to the dedicated subscription page's behavior

## Design

### 1. Shared module

Create `apps/client/src/components/billing/plan-card.tsx` exporting:

- `PlanCard` component + `PlanCardTheme` type
- Pure helpers: `formatMoney`, `formatInterval`, `formatPlanCredits`, `formatPlanOptionLabel`, `buildPlanFeatures`, `getPlanDescription`, `getPlanCardTheme`, `groupPlanProducts`, and the `PlanGroup` type

`SubscriptionContent.tsx` is modified to import from the new module. Internal helpers that `SubscriptionContent` uses but onboarding doesn't (e.g., `formatCredits`, `formatDate`, `formatStatusLabel`, `getPlanTierRank`, `getPlanGroupKey`) stay in `SubscriptionContent.tsx` unless they are transitive dependencies of the exported helpers, in which case they move too.

No behavior change in `SubscriptionContent.tsx` — pure refactor.

### 2. Onboarding `StepSix` rewrite

Replace the custom 2-column grid (onboarding.tsx:1775-1859) with:

```
const planGroups = groupPlanProducts(products).filter(
  (group) => group.title.trim().toLowerCase() !== "free"
);
```

Render `xl:grid-cols-3` of `<PlanCard>` per group. Per-group state: which `stripePriceId` (billing cycle) is currently selected in the dropdown — keep as a local `useState<Record<string, string>>`.

Each `PlanCard` uses:

- `badge` / `title` — `group.badge` / `group.title`
- `priceAmount` — `formatMoney(selected.amountCents)`
- `priceCycle` — `formatInterval(selected.interval, selected.intervalCount)`
- `description` — `getPlanDescription(group.title)`
- `features` — `buildPlanFeatures(selected)`
- `actionLabel` — `t("actions.startCheckout")` (keep onboarding i18n key)
- `onAction` — `() => onCheckout(selected)`
- `actionDisabled` — `checkoutPending`
- `theme` — `getPlanCardTheme(index, group.title)`
- `optionItems` / `optionValue` / `onOptionChange` — wired to local per-group selection state

### 3. Footer dock (`StepActionDock`) in StepSix

- **Before checkout completed**: show only `ContinueWithoutPlan` ghost button. The "Start Checkout" primary button is removed (its role is now inside each card).
- **After checkout completed**: unchanged — `Finish` button.

The `selectedPlanId` / `onSelectPlan` props and the radio-circle UI are removed from `StepSix`. The parent that passes these props (see onboarding.tsx around line 1143) is updated — `selectedPlanId` and `onSelectPlan` can be dropped from the StepSix prop contract.

### 4. Props diff for `StepSix`

Removed from StepSix: `selectedPlanId`, `onSelectPlan`.
Kept: `t`, `products`, `checkoutCompleted`, `loading`, `checkoutPending`, `onCheckout`, `onFinish`, `onContinueWithoutPlan`.

The parent's `planState.selectedPlan` state field (onboarding.tsx:153, 246, 652, 675, 752) **stays** — it is still written inside `handleCheckout` to record which plan was checked out, and persisted to step data for resumption. Only the prop wiring to StepSix (onboarding.tsx:1144, 1148-1153) is removed.

## Files Affected

- **New**: `apps/client/src/components/billing/plan-card.tsx`
- **Modified**:
  - `apps/client/src/components/layout/contents/SubscriptionContent.tsx` (imports moved out)
  - `apps/client/src/routes/_authenticated/onboarding.tsx` (StepSix rewritten + caller updated)

## Risks & Known Limitations

- StepSix's panel background is light (onboarding.tsx:933 — `linear-gradient(180deg,rgba(255,255,255,0.96),rgba(251,252,255,0.98))`), so `PlanCard` light/accent/dark themes will read correctly. No contrast risk.
- **i18n regression**: `getPlanDescription`, `buildPlanFeatures`, and `FREE_PLAN_FEATURES` in `SubscriptionContent.tsx` return hardcoded English strings. Using them in onboarding means non-English locales will see English text on this step. Matches the existing dedicated subscription page behavior, which is also English-only. Flagged as a known limitation, not addressed in this change.
- **`t("actions.startCheckout")` per-card**: the onboarding i18n key is currently used once (on the dock button). Reusing it on each card is semantically fine, but worth visually checking that the label length fits the black pill button in `PlanCard`.
- **Default cycle selection**: when initializing the per-group dropdown state, pick `group.products[0]` (lowest tier-rank / sortOrder per `groupPlanProducts`) to mirror subscription page behavior.
- Only Free is filtered; if Billing Hub introduces additional non-paid SKUs in the future, this filter may need expanding.

## Verification

- Dev server, run onboarding to the final step, visually confirm cards match the `/settings/billing` plans view (3 columns, themes, price cycle dropdown, "+" feature icons, rounded corners)
- Click "Start Checkout" on a card — checkout flow triggers for that specific cycle
- Click "Continue Without Plan" — proceeds to finish
- Confirm Free plan is not shown
- `/settings/billing` page is visually unchanged

# Onboarding Subscription PlanCard Alignment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the onboarding final step's subscription UI identical to the dedicated subscription page by reusing the `PlanCard` component; hide Free plan in onboarding.

**Architecture:** Extract `PlanCard` and its pure support helpers from [apps/client/src/components/layout/contents/SubscriptionContent.tsx](../../../apps/client/src/components/layout/contents/SubscriptionContent.tsx) into a shared module. Both the subscription page and onboarding `StepSix` import from that module. Onboarding groups products via the same `groupPlanProducts`, filters out Free, renders 3-column `<PlanCard>` grid, keeps onboarding-specific CTA text and "Continue Without Plan" footer.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, TanStack Router, shadcn/ui Select.

**Spec:** [docs/superpowers/specs/2026-04-12-onboarding-subscription-plan-card-alignment-design.md](../specs/2026-04-12-onboarding-subscription-plan-card-alignment-design.md)

**Testing strategy:** No unit tests exist for these UI components in the codebase. Verification = `pnpm --filter @team9/client typecheck` + `pnpm --filter @team9/client lint:ci` + manual dev-server smoke test per task where UI is affected. Commits batched at end of each task.

---

## File Structure

**New file:**

- `apps/client/src/components/billing/plan-card.tsx` — exports `PlanCard`, `PlanCardTheme`, `PlanGroup`, plus the pure helpers listed below.

**Modified:**

- `apps/client/src/components/layout/contents/SubscriptionContent.tsx` — imports moved helpers/component from new module. No behavior change.
- `apps/client/src/routes/_authenticated/onboarding.tsx` — `StepSix` rewritten to use `PlanCard`; caller in parent updates prop wiring.

**Helpers migrated to shared module:**
`formatMoney`, `formatCredits`, `formatInterval`, `formatPlanCredits`, `getPlanGroupTitle`, `getPlanGroupKey`, `getPlanTierRank`, `groupPlanProducts`, `formatPlanOptionLabel`, `buildPlanFeatures`, `getPlanDescription`, `getPlanCardTheme`, `PlanCard`, and the constants `FREE_PLAN_FEATURES`, types `PlanGroup` and `PlanCardTheme`.

**Helpers that stay in `SubscriptionContent.tsx`** (only used there):
`formatCreditsFromCents`, `formatDate`, `formatDateTime`, `formatStatusLabel`, `getCreditsPlanActionLabel`, `formatUsdInputValue`.

---

## Task 1: Extract `PlanCard` and helpers into shared module

**Files:**

- Create: `apps/client/src/components/billing/plan-card.tsx`

- [ ] **Step 1: Create the new file with full extracted content**

Create `apps/client/src/components/billing/plan-card.tsx` with the following content, copy-moved verbatim from [SubscriptionContent.tsx](../../../apps/client/src/components/layout/contents/SubscriptionContent.tsx) lines 52-73, 75-88, 102-115, 128-232, 234-313, 329-352, 492-656:

```tsx
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { BillingProduct } from "@/types/workspace";

export const FREE_PLAN_FEATURES = [
  "100 refresh credits every day",
  "4,000 credits per month",
  "In-depth research for everyday tasks",
  "Professional websites for standard output",
  "Insightful slides for regular content",
  "Task scaling with Wide Research",
  "Early access to beta features",
  "20 concurrent tasks",
  "20 scheduled tasks",
  "Shared team workspace billing",
];

export type PlanGroup = {
  key: string;
  title: string;
  badge: string;
  products: BillingProduct[];
  sortOrder: number;
};

export type PlanCardTheme = "free" | "accent" | "dark";

export function formatMoney(amountCents: number) {
  const hasFraction = amountCents % 100 !== 0;

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(amountCents / 100);
}

export function formatCredits(amount: number) {
  return `${new Intl.NumberFormat("en-US").format(amount)} credits`;
}

export function formatInterval(
  interval: string | null | undefined,
  intervalCount: number | null | undefined,
) {
  if (!interval) {
    return null;
  }

  if (!intervalCount || intervalCount === 1) {
    return interval;
  }

  return `${intervalCount} ${interval}s`;
}

export function formatPlanCredits(product: BillingProduct) {
  if (!product.credits) {
    return "Credits configured in Billing Hub";
  }

  const cycle = formatInterval(product.interval, product.intervalCount);
  return cycle
    ? `${formatCredits(product.credits)} / ${cycle}`
    : formatCredits(product.credits);
}

function getPlanGroupTitle(product: BillingProduct) {
  return product.name.trim();
}

function getPlanGroupKey(product: BillingProduct) {
  return getPlanGroupTitle(product).toLowerCase();
}

function getPlanTierRank(productOrTitle: BillingProduct | string) {
  const normalizedValue =
    typeof productOrTitle === "string"
      ? productOrTitle
      : `${productOrTitle.name} ${productOrTitle.display.badge ?? ""}`;
  const normalized = normalizedValue.trim().toLowerCase();

  if (normalized.includes("starter")) {
    return 10;
  }

  if (normalized.includes("pro")) {
    return 20;
  }

  if (normalized.includes("business")) {
    return 30;
  }

  if (normalized.includes("enterprise")) {
    return 40;
  }

  return 100;
}

export function groupPlanProducts(products: BillingProduct[]): PlanGroup[] {
  const groups = new Map<string, PlanGroup>();

  for (const product of products) {
    const key = getPlanGroupKey(product);
    const existingGroup = groups.get(key);

    if (existingGroup) {
      existingGroup.products.push(product);
      existingGroup.sortOrder = Math.min(
        existingGroup.sortOrder,
        product.display.sortOrder ?? Number.MAX_SAFE_INTEGER,
      );
      continue;
    }

    groups.set(key, {
      key,
      title: getPlanGroupTitle(product),
      badge: getPlanGroupTitle(product),
      products: [product],
      sortOrder: product.display.sortOrder ?? Number.MAX_SAFE_INTEGER,
    });
  }

  return [...groups.values()]
    .sort((left, right) => {
      const tierRankDiff =
        getPlanTierRank(left.title) - getPlanTierRank(right.title);

      if (tierRankDiff !== 0) {
        return tierRankDiff;
      }

      return left.sortOrder - right.sortOrder;
    })
    .map((group) => ({
      ...group,
      products: [...group.products].sort((left, right) => {
        const tierRankDiff = getPlanTierRank(left) - getPlanTierRank(right);

        if (tierRankDiff !== 0) {
          return tierRankDiff;
        }

        const leftOrder = left.display.sortOrder ?? Number.MAX_SAFE_INTEGER;
        const rightOrder = right.display.sortOrder ?? Number.MAX_SAFE_INTEGER;

        if (leftOrder !== rightOrder) {
          return leftOrder - rightOrder;
        }

        if ((left.credits ?? 0) !== (right.credits ?? 0)) {
          return (left.credits ?? 0) - (right.credits ?? 0);
        }

        return left.amountCents - right.amountCents;
      }),
    }));
}

export function formatPlanOptionLabel(product: BillingProduct) {
  return formatPlanCredits(product);
}

export function buildPlanFeatures(product: BillingProduct) {
  const normalizedTitle = product.name.trim().toLowerCase();
  const monthlyCredits = product.credits
    ? `${new Intl.NumberFormat("en-US").format(product.credits)} credits per month`
    : "Monthly credits configured in Billing Hub";

  if (normalizedTitle.includes("starter")) {
    return [
      "300 refresh credits every day",
      monthlyCredits,
      "In-depth research with self-set usage",
      "Professional websites for changing needs",
      "Insightful slides for steady creation",
      "Wide Research scaled to your chosen plan",
      "Early access to beta features",
      "20 concurrent tasks",
      "20 scheduled tasks",
      "Priority support for workspace admins",
    ];
  }

  if (
    normalizedTitle.includes("pro") ||
    normalizedTitle.includes("business") ||
    normalizedTitle.includes("enterprise")
  ) {
    return [
      "300 refresh credits every day",
      monthlyCredits,
      "In-depth research for large-scale tasks",
      "Professional websites with data analytics",
      "Insightful slides for batch production",
      "Wide Research for sustained heavy use",
      "Early access to beta features",
      "20 concurrent tasks",
      "20 scheduled tasks",
      "Advanced billing controls and reporting",
    ];
  }

  const baseFeatures = product.display.features.filter(Boolean);
  const features: string[] = [];

  for (const feature of [
    ...baseFeatures,
    monthlyCredits,
    "Shared workspace billing controls for owners and admins",
    "Managed through Billing Hub checkout and portal",
  ]) {
    if (!feature || features.includes(feature)) {
      continue;
    }

    features.push(feature);
  }

  return features.slice(0, 10);
}

export function getPlanDescription(title: string) {
  const normalizedTitle = title.trim().toLowerCase();

  if (normalizedTitle.includes("starter")) {
    return "适合稳定使用场景，能覆盖大部分日常需求。";
  }

  if (
    normalizedTitle.includes("pro") ||
    normalizedTitle.includes("business") ||
    normalizedTitle.includes("enterprise")
  ) {
    return "适合重度使用团队，强调更高额度和更高优先级。";
  }

  return "适合先体验产品，保留最基本的额度与能力。";
}

export function getPlanCardTheme(index: number, title: string): PlanCardTheme {
  const normalizedTitle = title.toLowerCase();

  if (normalizedTitle.includes("starter")) {
    return "accent";
  }

  if (normalizedTitle.includes("pro")) {
    return "dark";
  }

  if (
    normalizedTitle.includes("business") ||
    normalizedTitle.includes("enterprise")
  ) {
    return "dark";
  }

  if (index === 0) {
    return "accent";
  }

  return index % 2 === 1 ? "dark" : "accent";
}

export function PlanCard({
  badge,
  title,
  priceAmount,
  priceCycle,
  description,
  features,
  actionLabel,
  onAction,
  actionDisabled = false,
  theme,
  optionItems,
  optionValue,
  onOptionChange,
}: {
  badge: string;
  title: string;
  priceAmount: string;
  priceCycle?: string | null;
  description: string;
  features: string[];
  actionLabel: string;
  onAction?: () => void;
  actionDisabled?: boolean;
  theme: PlanCardTheme;
  optionItems?: { value: string; label: string }[];
  optionValue?: string;
  onOptionChange?: (value: string) => void;
}) {
  const isDark = theme === "dark";

  return (
    <section
      className={cn(
        "relative flex h-full flex-col overflow-hidden rounded-[1.4rem] border px-5 py-5 shadow-[0_28px_90px_-50px_rgba(15,23,42,0.3)]",
        theme === "free" &&
          "border-slate-200/80 bg-[linear-gradient(180deg,#ffffff_0%,#f4f8ff_100%)] text-slate-950",
        theme === "accent" &&
          "border-[#78a9ff] bg-[linear-gradient(180deg,#f8fbff_0%,#dfeafc_100%)] text-slate-950",
        theme === "dark" &&
          "border-slate-700 bg-[linear-gradient(180deg,#313f61_0%,#27395f_100%)] text-white",
      )}
    >
      <div
        className={cn(
          "pointer-events-none absolute inset-0",
          theme === "free" &&
            "bg-[radial-gradient(circle_at_top_left,rgba(225,235,255,0.95),transparent_40%),radial-gradient(circle_at_bottom_right,rgba(214,226,245,0.45),transparent_36%)]",
          theme === "accent" &&
            "bg-[radial-gradient(circle_at_top_center,rgba(255,255,255,0.95),transparent_34%),radial-gradient(circle_at_bottom_left,rgba(116,169,255,0.18),transparent_38%)]",
          theme === "dark" &&
            "bg-[radial-gradient(circle_at_top_left,rgba(130,152,196,0.2),transparent_36%),radial-gradient(circle_at_bottom_right,rgba(14,23,43,0.15),transparent_32%)]",
        )}
      />

      <div className="relative flex h-full flex-col">
        <div
          className={cn(
            "w-fit rounded-full px-4 py-2 text-base font-semibold tracking-tight",
            theme === "free" && "bg-slate-100 text-slate-600",
            theme === "accent" && "bg-[#d6e4ff] text-[#315d9f]",
            theme === "dark" && "bg-white/12 text-white/90",
          )}
        >
          {badge}
        </div>

        <div className="mt-5">
          <div
            className={cn(
              "text-[2.8rem] leading-none font-semibold tracking-[-0.06em] sm:text-[3.15rem]",
              isDark ? "text-white" : "text-[#18325d]",
            )}
          >
            {priceAmount}
            {priceCycle ? (
              <span
                className={cn(
                  "ml-2 text-lg font-medium tracking-normal",
                  isDark ? "text-white/85" : "text-[#54698d]",
                )}
              >
                / {priceCycle}
              </span>
            ) : null}
          </div>
          <p
            className={cn(
              "mt-3.5 min-h-[4rem] text-[0.95rem] leading-6 font-medium",
              isDark ? "text-white/86" : "text-[#5d7295]",
            )}
          >
            {description}
          </p>
        </div>

        <Button
          className={cn(
            "mt-3.5 h-11 w-full rounded-full border border-black/10 bg-[#151515] text-base font-semibold text-white shadow-none hover:bg-black/90",
            actionDisabled && "opacity-100",
          )}
          onClick={onAction}
          disabled={actionDisabled}
        >
          {actionLabel}
        </Button>

        {optionItems?.length ? (
          <div className="mt-3.5">
            <Select value={optionValue} onValueChange={onOptionChange}>
              <SelectTrigger
                aria-label={`${title} plan credits`}
                className={cn(
                  "h-[3.5rem] rounded-[1rem] border px-4 text-left text-[0.95rem] font-semibold shadow-[0_18px_40px_-30px_rgba(15,23,42,0.35)] [&>svg]:size-4 [&>svg]:opacity-55",
                  isDark
                    ? "border-transparent bg-white text-[#383838]"
                    : "border-[#8eb5ff] bg-[linear-gradient(180deg,#bfe6ff_0%,#ffffff_72%)] text-[#1b2b44]",
                )}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent
                className={cn(
                  "rounded-[1.4rem] border p-2 shadow-[0_24px_60px_-36px_rgba(15,23,42,0.45)]",
                  isDark
                    ? "border-slate-200 bg-white"
                    : "border-[#8eb5ff] bg-[#f6fbff]",
                )}
              >
                {optionItems.map((option) => (
                  <SelectItem
                    key={option.value}
                    value={option.value}
                    showIndicator={false}
                    className="min-h-9 rounded-lg px-4 py-2 text-sm font-medium text-[#243247] focus:bg-[#4b8eea] focus:text-white"
                  >
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        <div className="mt-4 space-y-3">
          {features.map((feature) => (
            <div
              key={feature}
              className="flex items-start gap-2.5 text-[0.88rem] leading-6"
            >
              <Plus
                className={cn(
                  "mt-1.5 h-3 w-3 shrink-0",
                  isDark ? "text-[#7fb4ff]" : "text-[#4588ee]",
                )}
              />
              <span className={cn(isDark ? "text-white/84" : "text-[#607698]")}>
                {feature}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Typecheck new file is importable**

Run: `pnpm --filter @team9/client typecheck`
Expected: PASS (no errors; file is not referenced yet but must compile standalone).

- [ ] **Step 3: No commit yet**

Do not commit. The old file still has duplicates — Task 2 resolves them together.

---

## Task 2: Re-point `SubscriptionContent.tsx` to shared module

**Files:**

- Modify: `apps/client/src/components/layout/contents/SubscriptionContent.tsx`

- [ ] **Step 1: Delete duplicate definitions from `SubscriptionContent.tsx`**

Delete these blocks (line numbers as of the current file):

- `FREE_PLAN_FEATURES` (lines 52-63)
- `type PlanGroup` (lines 65-71)
- `type PlanCardTheme` (line 73)
- `formatMoney` (lines 75-84)
- `formatCredits` (lines 86-88)
- `formatInterval` (lines 102-115)
- `formatPlanCredits` (lines 128-137)
- `getPlanGroupTitle` (lines 139-141)
- `getPlanGroupKey` (lines 143-145)
- `getPlanTierRank` (lines 147-171)
- `groupPlanProducts` (lines 173-232)
- `formatPlanOptionLabel` (lines 234-236)
- `buildPlanFeatures` (lines 238-295)
- `getPlanDescription` (lines 297-313)
- `getPlanCardTheme` (lines 329-352)
- `PlanCard` function (lines 492-656)

Also delete the import lines for `Plus` from `lucide-react`, and `Select*` from `@/components/ui/select` **only if unused elsewhere in the file after deletion** — verify before deleting (use Grep on the remaining file).

- [ ] **Step 2: Add import from shared module**

At the top of `SubscriptionContent.tsx`, add:

```tsx
import {
  FREE_PLAN_FEATURES,
  PlanCard,
  buildPlanFeatures,
  formatCredits,
  formatInterval,
  formatMoney,
  formatPlanCredits,
  formatPlanOptionLabel,
  getPlanCardTheme,
  getPlanDescription,
  groupPlanProducts,
} from "@/components/billing/plan-card";
```

Keep existing imports of `ShieldAlert`, `AlertDialog*`, `Button`, `Card*`, `Input`, `ScrollArea`, date helpers, workspace hooks, types, etc. intact.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @team9/client typecheck`
Expected: PASS.

- [ ] **Step 4: Lint**

Run: `pnpm --filter @team9/client lint:ci`
Expected: PASS.

- [ ] **Step 5: Smoke test the dedicated subscription page**

Start dev server: `pnpm dev:client` (in one terminal).
Navigate to the subscription/billing settings page in the browser. Confirm the plans view renders identically to before (3 columns, themes, dropdown, features) — this is a pure refactor and must be visually unchanged.

- [ ] **Step 6: Commit**

```bash
git add apps/client/src/components/billing/plan-card.tsx \
        apps/client/src/components/layout/contents/SubscriptionContent.tsx
git commit -m "refactor(billing): extract PlanCard into shared module"
```

---

## Task 3: Rewrite onboarding `StepSix` to use `PlanCard`

**Files:**

- Modify: `apps/client/src/routes/_authenticated/onboarding.tsx` (StepSix function at lines 1731-1904, caller at lines 1140-1164)

- [ ] **Step 1: Add imports at top of `onboarding.tsx`**

Add (or merge into existing imports):

```tsx
import {
  PlanCard,
  buildPlanFeatures,
  formatInterval,
  formatMoney,
  formatPlanOptionLabel,
  getPlanCardTheme,
  getPlanDescription,
  groupPlanProducts,
} from "@/components/billing/plan-card";
```

If `useState` is not already imported from React, ensure it is imported.

- [ ] **Step 2: Replace `StepSix` function body**

Replace the entire `StepSix` function (current lines 1731-1904) with:

```tsx
function StepSix({
  t,
  products,
  checkoutCompleted,
  loading,
  checkoutPending,
  onCheckout,
  onFinish,
  onContinueWithoutPlan,
}: {
  t: TranslateFn;
  products: BillingProduct[];
  checkoutCompleted: boolean;
  loading: boolean;
  checkoutPending: boolean;
  onCheckout: (product: BillingProduct) => void;
  onFinish: () => void;
  onContinueWithoutPlan: () => void;
}) {
  const paidGroups = useMemo(
    () =>
      groupPlanProducts(products).filter(
        (group) => group.title.trim().toLowerCase() !== "free",
      ),
    [products],
  );

  const [selectedByGroup, setSelectedByGroup] = useState<
    Record<string, string>
  >({});

  useEffect(() => {
    setSelectedByGroup((current) => {
      const next = { ...current };
      let changed = false;
      for (const group of paidGroups) {
        const exists = group.products.some(
          (product) => product.stripePriceId === next[group.key],
        );
        if (!exists) {
          next[group.key] = group.products[0]?.stripePriceId ?? "";
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [paidGroups]);

  if (loading) {
    return (
      <GenerationState
        title={t("plan.loadingTitle")}
        description={t("plan.empty")}
      />
    );
  }

  return (
    <div className="grid gap-6">
      {checkoutCompleted ? (
        <div className="rounded-[24px] border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-700">
          {t("plan.success")}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-3">
        {paidGroups.map((group, groupIndex) => {
          const selectedPriceId =
            selectedByGroup[group.key] ?? group.products[0].stripePriceId;
          const selectedProduct =
            group.products.find(
              (product) => product.stripePriceId === selectedPriceId,
            ) ?? group.products[0];
          const cycle = formatInterval(
            selectedProduct.interval,
            selectedProduct.intervalCount,
          );

          return (
            <PlanCard
              key={group.key}
              badge={group.badge}
              title={group.title}
              priceAmount={formatMoney(selectedProduct.amountCents)}
              priceCycle={cycle}
              description={getPlanDescription(group.title)}
              features={buildPlanFeatures(selectedProduct)}
              actionLabel={t("actions.startCheckout")}
              actionDisabled={checkoutPending || checkoutCompleted}
              onAction={() => onCheckout(selectedProduct)}
              theme={getPlanCardTheme(groupIndex, group.title)}
              optionItems={group.products.map((product) => ({
                value: product.stripePriceId,
                label: formatPlanOptionLabel(product),
              }))}
              optionValue={selectedProduct.stripePriceId}
              onOptionChange={(nextValue) =>
                setSelectedByGroup((current) => ({
                  ...current,
                  [group.key]: nextValue,
                }))
              }
            />
          );
        })}
      </div>

      {paidGroups.length === 0 ? (
        <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-6 text-sm text-slate-500">
          {t("plan.empty")}
        </div>
      ) : null}

      <StepActionDock>
        {checkoutCompleted ? (
          <ContinueButton
            onClick={onFinish}
            disabled={checkoutPending}
            className="shadow-[0_18px_36px_rgba(31,111,235,0.22)]"
          >
            {t("actions.finish")}
          </ContinueButton>
        ) : (
          <GhostButton
            onClick={onContinueWithoutPlan}
            disabled={checkoutPending}
            className="bg-white/86 text-slate-600"
          >
            {t("actions.continueWithoutPlan")}
          </GhostButton>
        )}
      </StepActionDock>
    </div>
  );
}
```

Note: `useMemo` and `useEffect` must be available — add them to the existing React import if not already present.

- [ ] **Step 3: Update StepSix caller (lines 1140-1164)**

Replace the `<StepSix … />` JSX block at lines 1140-1164 with:

```tsx
{
  currentStep === 6 && (
    <StepSix
      t={t}
      products={planProducts}
      checkoutCompleted={Boolean(planState.checkoutCompleted)}
      loading={billingProductsQuery.isLoading}
      checkoutPending={checkout.isPending || isFinishing}
      onCheckout={(product) => {
        void handleCheckout(product);
      }}
      onFinish={() => {
        void handleContinue();
      }}
      onContinueWithoutPlan={() => {
        void handleContinue();
      }}
    />
  );
}
```

`selectedPlanId` and `onSelectPlan` props are removed. The parent's `planState.selectedPlan` field stays and is still written inside `handleCheckout`.

- [ ] **Step 4: Remove now-unused imports**

After deleting the old `StepSix` body, these imports may be unused in `onboarding.tsx`:

- `Loader2` from `lucide-react` (was used only by the deleted "Start Checkout" dock button)
- `cn` from `@/lib/utils` (was used only in the deleted radio-card styling) — verify before deleting.

Use Grep on the remaining file to confirm each before removing. Keep imports that are still referenced.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @team9/client typecheck`
Expected: PASS.

- [ ] **Step 6: Lint**

Run: `pnpm --filter @team9/client lint:ci`
Expected: PASS.

- [ ] **Step 7: Manual smoke test**

Start dev server if not running: `pnpm dev:client`.

In the browser:

1. Trigger onboarding (e.g., new user or reset onboarding state) and advance to step 6.
2. Confirm plan cards render 3-column grid on `xl` breakpoint, 1-column on narrow screens.
3. Confirm Free plan is **not** shown.
4. Confirm visual parity with `/settings/billing` plans view: rounded `1.4rem` corners, theme gradients, `Plus` icon features, billing-cycle dropdown.
5. Change the dropdown on a card — price/features update to that cycle's product.
6. Click "Start Checkout" on a card — `handleCheckout` fires for that cycle's product (Stripe redirect / checkout flow begins).
7. Click "Continue Without Plan" — flow advances to finish.
8. Confirm `/settings/billing` plans view still renders unchanged.

- [ ] **Step 8: Commit**

```bash
git add apps/client/src/routes/_authenticated/onboarding.tsx
git commit -m "feat(onboarding): align step 6 plan cards with subscription page"
```

---

## Self-Review

**Spec coverage:**

- §1 Shared module → Task 1 ✓
- §2 Onboarding StepSix rewrite → Task 3 steps 2-3 ✓
- §3 Footer dock behavior → Task 3 step 2 (bottom of function) ✓
- §4 Props diff → Task 3 step 3 ✓
- Files affected list → Tasks 1-3 cover all three files ✓
- Risks: background compatibility, i18n limitation, cycle default selection → addressed in Task 3 step 2 (default via `group.products[0]`) ✓

**Placeholder scan:** None found — every code block is complete, file paths are exact, line numbers are current.

**Type consistency:**

- `PlanCard` signature matches between the shared module (Task 1) and consumers (Task 2 subscription page import, Task 3 onboarding usage). ✓
- `groupPlanProducts` returns `PlanGroup[]` — consistent usage in both consumers. ✓
- `BillingProduct` imported from `@/types/workspace` in all three files. ✓
- `selectedByGroup` keyed by `group.key` (lowercase trimmed title) — consistent with `PlanGroup.key` definition. ✓

---

Plan complete and saved to `docs/superpowers/plans/2026-04-12-onboarding-subscription-plan-card-alignment.md`. Two execution options:

**1. Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?

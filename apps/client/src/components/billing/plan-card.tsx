import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import i18n from "@/i18n";
import { cn } from "@/lib/utils";
import type { BillingProduct } from "@/types/workspace";

type WorkspaceT = (key: string, options?: Record<string, unknown>) => string;

export type PlanGroup = {
  key: string;
  title: string;
  badge: string;
  products: BillingProduct[];
  sortOrder: number;
};

export type PlanCardTheme = "free" | "plus" | "pro";

function getLocale() {
  return i18n.language ?? i18n.resolvedLanguage ?? "en";
}

function formatNumber(value: number) {
  return new Intl.NumberFormat(getLocale()).format(value);
}

function getWorkspaceT(): WorkspaceT {
  return i18n.getFixedT(getLocale(), "workspace") as WorkspaceT;
}

export function formatMoney(amountCents: number) {
  const hasFraction = amountCents % 100 !== 0;

  return new Intl.NumberFormat(getLocale(), {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(amountCents / 100);
}

export function formatCredits(amount: number) {
  const t = getWorkspaceT();
  return t("billing.plans.creditsLabel", {
    credits: formatNumber(amount),
  });
}

export function formatInterval(
  interval: string | null | undefined,
  intervalCount: number | null | undefined,
) {
  if (!interval) {
    return null;
  }

  const t = getWorkspaceT();
  const count = intervalCount ?? 1;
  const fallback = count === 1 ? interval : `${count} ${interval}s`;

  return t(`billing.interval.${interval}`, {
    count,
    defaultValue: fallback,
  });
}

export function formatPlanCredits(product: BillingProduct) {
  const t = getWorkspaceT();

  if (!product.credits) {
    return t("billing.plans.creditsConfiguredInBillingHub");
  }

  const cycle = formatInterval(product.interval, product.intervalCount);
  return cycle
    ? t("billing.plans.planCreditsWithCycle", {
        credits: formatNumber(product.credits),
        cycle,
      })
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

  if (normalized.includes("plus")) {
    return 15;
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

function resolvePlanCopyKey(title: string) {
  const normalizedTitle = title.trim().toLowerCase();

  if (normalizedTitle.includes("free")) {
    return "free" as const;
  }

  if (normalizedTitle.includes("plus") || normalizedTitle.includes("starter")) {
    return "plus" as const;
  }

  if (
    normalizedTitle.includes("pro") ||
    normalizedTitle.includes("business") ||
    normalizedTitle.includes("enterprise")
  ) {
    return "pro" as const;
  }

  return "generic" as const;
}

export function getFreePlanFeatures() {
  const t = getWorkspaceT();

  return [
    t("billing.plans.free.features.oneTimeCredits"),
    t("billing.plans.free.features.coreModels"),
    t("billing.plans.free.features.basicResearch"),
    t("billing.plans.free.features.fileMemory"),
    t("billing.plans.free.features.agentTools"),
    t("billing.plans.free.features.multiAgent"),
    t("billing.plans.free.features.beta"),
  ];
}

export function buildPlanFeatures(product: BillingProduct) {
  const t = getWorkspaceT();
  const planCopyKey = resolvePlanCopyKey(product.name);
  const monthlyCredits = product.credits
    ? t("billing.plans.monthlyCredits", {
        credits: formatNumber(product.credits),
      })
    : t("billing.plans.creditsConfiguredInBillingHub");

  if (planCopyKey === "plus") {
    return [
      monthlyCredits,
      t("billing.plans.plus.features.modelAccess"),
      t("billing.plans.plus.features.nanoBanana"),
      t("billing.plans.plus.features.fileMemory"),
      t("billing.plans.plus.features.premiumTools"),
      t("billing.plans.plus.features.multiAgent"),
      t("billing.plans.plus.features.beta"),
      t("billing.plans.plus.features.support"),
    ];
  }

  if (planCopyKey === "pro") {
    return [
      monthlyCredits,
      t("billing.plans.pro.features.modelAccess"),
      t("billing.plans.pro.features.nanoBanana"),
      t("billing.plans.pro.features.fileMemory"),
      t("billing.plans.pro.features.premiumTools"),
      t("billing.plans.pro.features.multiAgent"),
      t("billing.plans.pro.features.beta"),
      t("billing.plans.pro.features.support"),
    ];
  }

  const baseFeatures = product.display.features.filter(Boolean);
  const features: string[] = [];

  for (const feature of [
    ...baseFeatures,
    monthlyCredits,
    t("billing.plans.generic.features.sharedBilling"),
    t("billing.plans.generic.features.managedThroughBillingHub"),
  ]) {
    if (!feature || features.includes(feature)) {
      continue;
    }

    features.push(feature);
  }

  return features.slice(0, 10);
}

export function getPlanDescription(title: string) {
  const t = getWorkspaceT();

  switch (resolvePlanCopyKey(title)) {
    case "free":
      return t("billing.plans.free.description");
    case "plus":
      return t("billing.plans.plus.description");
    case "pro":
      return t("billing.plans.pro.description");
    default:
      return t("billing.plans.generic.description");
  }
}

export function getPlanCardTheme(index: number, title: string): PlanCardTheme {
  const normalizedTitle = title.toLowerCase();

  if (normalizedTitle.includes("starter")) {
    return "plus";
  }

  if (normalizedTitle.includes("plus")) {
    return "plus";
  }

  if (normalizedTitle.includes("pro")) {
    return "pro";
  }

  if (
    normalizedTitle.includes("business") ||
    normalizedTitle.includes("enterprise")
  ) {
    return "pro";
  }

  if (index === 0) {
    return "plus";
  }

  return index % 2 === 1 ? "pro" : "plus";
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
  return (
    <section
      className={cn(
        "relative flex h-full flex-col overflow-hidden rounded-[1.4rem] border px-5 py-5 shadow-[0_28px_90px_-50px_rgba(15,23,42,0.3)]",
        theme === "free" &&
          "border-slate-200/80 bg-[linear-gradient(180deg,#ffffff_0%,#f4f8ff_100%)] text-slate-950",
        theme === "plus" &&
          "border-[#d4e2fb] bg-[linear-gradient(180deg,#fbfdff_0%,#eef4ff_58%,#e6efff_100%)] text-slate-950 shadow-[0_34px_95px_-58px_rgba(72,104,164,0.2)]",
        theme === "pro" &&
          "border-[#eadcc0] bg-[linear-gradient(180deg,#fffdf9_0%,#f9f2e7_56%,#f4ebdc_100%)] text-slate-950 shadow-[0_34px_95px_-58px_rgba(151,116,60,0.16)]",
      )}
    >
      <div
        className={cn(
          "pointer-events-none absolute inset-0",
          theme === "free" &&
            "bg-[radial-gradient(circle_at_top_left,rgba(225,235,255,0.95),transparent_40%),radial-gradient(circle_at_bottom_right,rgba(214,226,245,0.45),transparent_36%)]",
          theme === "plus" &&
            "bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.98),transparent_36%),radial-gradient(circle_at_top_right,rgba(183,205,246,0.34),transparent_30%),radial-gradient(circle_at_bottom_left,rgba(126,171,255,0.12),transparent_42%)]",
          theme === "pro" &&
            "bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.98),transparent_36%),radial-gradient(circle_at_top_right,rgba(244,229,200,0.5),transparent_30%),radial-gradient(circle_at_bottom_left,rgba(219,177,108,0.12),transparent_42%)]",
        )}
      />

      <div className="relative flex h-full flex-col">
        <div
          className={cn(
            "w-fit rounded-full border px-4 py-2 text-base font-semibold tracking-tight backdrop-blur",
            theme === "free" && "bg-slate-100 text-slate-600",
            theme === "plus" && "border-white/70 bg-white/74 text-[#44638f]",
            theme === "pro" && "border-[#efe2c7] bg-white/76 text-[#8b6738]",
          )}
        >
          {badge}
        </div>

        <div className="mt-5">
          <div
            className={cn(
              "text-[2.8rem] leading-none font-semibold tracking-[-0.06em] sm:text-[3.15rem]",
              theme === "pro" ? "text-[#3f3120]" : "text-[#18325d]",
            )}
          >
            {priceAmount}
            {priceCycle ? (
              <span
                className={cn(
                  "ml-2 text-lg font-medium tracking-normal",
                  theme === "pro" ? "text-[#8a7355]" : "text-[#607290]",
                )}
              >
                / {priceCycle}
              </span>
            ) : null}
          </div>
          <p
            className={cn(
              "mt-3.5 min-h-[4rem] text-[0.95rem] leading-6 font-medium",
              theme === "pro" ? "text-[#7a6750]" : "text-[#667a98]",
            )}
          >
            {description}
          </p>
        </div>

        <Button
          className={cn(
            "mt-3.5 h-11 w-full rounded-full text-base font-semibold transition-all duration-200 transform-gpu hover:-translate-y-1 active:translate-y-0",
            theme === "plus" &&
              "border border-[#25324a]/8 bg-[linear-gradient(180deg,#25324a_0%,#161f31_100%)] text-white shadow-[0_18px_34px_-18px_rgba(72,104,164,0.24)] hover:brightness-[1.04] hover:shadow-[0_28px_44px_-18px_rgba(72,104,164,0.32)]",
            theme === "pro" &&
              "border border-[#2a2114]/8 bg-[linear-gradient(180deg,#2b241c_0%,#19130d_100%)] text-white shadow-[0_18px_34px_-18px_rgba(151,116,60,0.22)] hover:brightness-[1.04] hover:shadow-[0_28px_44px_-18px_rgba(151,116,60,0.3)]",
            theme === "free" &&
              "border border-black/10 bg-[linear-gradient(180deg,#1f2937_0%,#111827_100%)] text-white shadow-[0_16px_28px_-18px_rgba(15,23,42,0.28)] hover:brightness-[1.03] hover:shadow-[0_24px_36px_-18px_rgba(15,23,42,0.38)]",
            actionDisabled && "opacity-100",
          )}
          onClick={onAction}
          disabled={actionDisabled}
        >
          <span>{actionLabel}</span>
        </Button>

        {optionItems?.length ? (
          <div className="mt-3.5">
            <Select value={optionValue} onValueChange={onOptionChange}>
              <SelectTrigger
                aria-label={`${title} plan credits`}
                className={cn(
                  "h-[3.5rem] rounded-[1rem] border px-4 text-left text-[0.95rem] font-semibold shadow-[0_18px_40px_-30px_rgba(15,23,42,0.35)] [&>svg]:size-4 [&>svg]:opacity-55",
                  theme === "plus" &&
                    "border-[#d5e2fb] bg-[linear-gradient(180deg,#ffffff_0%,#f1f6ff_100%)] text-[#243247]",
                  theme === "pro" &&
                    "border-[#eadac0] bg-[linear-gradient(180deg,#fffdfa_0%,#faf2e5_100%)] text-[#4a3821]",
                  theme === "free" &&
                    "border-[#8eb5ff] bg-[linear-gradient(180deg,#bfe6ff_0%,#ffffff_72%)] text-[#1b2b44]",
                )}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent
                className={cn(
                  "rounded-[1.4rem] border p-2 shadow-[0_24px_60px_-36px_rgba(15,23,42,0.45)]",
                  theme === "plus" && "border-[#d5e2fb] bg-white",
                  theme === "pro" && "border-[#eadac0] bg-white",
                  theme === "free" && "border-[#8eb5ff] bg-[#f6fbff]",
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
                  theme === "plus" && "text-[#6d92d0]",
                  theme === "pro" && "text-[#b78c4f]",
                  theme === "free" && "text-[#4588ee]",
                )}
              />
              <span
                className={cn(
                  theme === "plus" && "text-[#617693]",
                  theme === "pro" && "text-[#6c5a45]",
                  theme === "free" && "text-[#607698]",
                )}
              >
                {feature}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

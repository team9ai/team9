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

import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Plus, ShieldAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useCreateWorkspaceBillingCheckout,
  useCreateWorkspaceBillingPortal,
  useWorkspaceBillingOverview,
} from "@/hooks/useWorkspaceBilling";
import { useUserWorkspaces } from "@/hooks/useWorkspace";
import { openExternalUrl } from "@/lib/open-external-url";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/stores";
import type {
  BillingProduct,
  BillingProductCustomAmount,
  WorkspaceBillingAccount,
  WorkspaceBillingTransaction,
} from "@/types/workspace";

type BillingView = "plans" | "credits";

interface SubscriptionContentProps {
  workspaceIdFromSearch?: string;
  view?: BillingView;
}

const FREE_PLAN_FEATURES = [
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

type PlanGroup = {
  key: string;
  title: string;
  badge: string;
  products: BillingProduct[];
  sortOrder: number;
};

type PlanCardTheme = "free" | "accent" | "dark";

function formatMoney(amountCents: number) {
  const hasFraction = amountCents % 100 !== 0;

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(amountCents / 100);
}

function formatCredits(amount: number) {
  return `${new Intl.NumberFormat("en-US").format(amount)} credits`;
}

function formatCreditsFromCents(amountCents: number) {
  return formatCredits(amountCents * 10);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
  }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatInterval(
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

function formatStatusLabel(value: string | null | undefined) {
  if (!value) {
    return "Unknown";
  }

  return value
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function formatPlanCredits(product: BillingProduct) {
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

function groupPlanProducts(products: BillingProduct[]) {
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

function formatPlanOptionLabel(product: BillingProduct) {
  return formatPlanCredits(product);
}

function buildPlanFeatures(product: BillingProduct) {
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

function getPlanDescription(title: string) {
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

function getCreditsPlanDescription(title: string) {
  const normalizedTitle = title.trim().toLowerCase();

  if (normalizedTitle.includes("starter")) {
    return "Configurable monthly credits with priority support.";
  }

  if (
    normalizedTitle.includes("pro") ||
    normalizedTitle.includes("business") ||
    normalizedTitle.includes("enterprise")
  ) {
    return "Higher monthly credits with stronger priority and reporting.";
  }

  return "Basic monthly credits for early workspace exploration.";
}

function getCreditsPlanActionLabel(title: string) {
  const normalizedTitle = title.trim().toLowerCase();

  if (
    normalizedTitle.includes("pro") ||
    normalizedTitle.includes("business") ||
    normalizedTitle.includes("enterprise")
  ) {
    return "Change plan";
  }

  return "Upgrade";
}

function getPlanCardTheme(index: number, title: string): PlanCardTheme {
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

function formatUsdInputValue(amountCents: number) {
  const dollars = amountCents / 100;
  return Number.isInteger(dollars) ? String(dollars) : dollars.toFixed(2);
}

function parseUsdInputToCents(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (!/^\d+(\.\d{0,2})?$/.test(trimmed)) {
    return null;
  }

  const amount = Number(trimmed);
  if (!Number.isFinite(amount)) {
    return null;
  }

  return Math.round(amount * 100);
}

function formatCustomAmountRange(config: BillingProductCustomAmount | null) {
  if (!config?.enabled || !config.minimumCents) {
    return null;
  }

  if (config.maximumCents) {
    return `Enter between ${formatMoney(config.minimumCents)} and ${formatMoney(
      config.maximumCents,
    )}.`;
  }

  return `Minimum top-up is ${formatMoney(config.minimumCents)}.`;
}

function getCustomAmountError(
  inputValue: string,
  amountCents: number | null,
  config: BillingProductCustomAmount | null,
) {
  if (!config?.enabled) {
    return "Custom amount top-up isn't configured for this workspace.";
  }

  if (!inputValue.trim()) {
    return "Enter a USD amount to top up this workspace.";
  }

  if (amountCents === null) {
    return "Enter a valid USD amount with up to 2 decimals.";
  }

  if (config.minimumCents && amountCents < config.minimumCents) {
    return `Minimum top-up is ${formatMoney(config.minimumCents)}.`;
  }

  if (
    config.maximumCents !== null &&
    config.maximumCents !== undefined &&
    amountCents > config.maximumCents
  ) {
    return `Maximum top-up is ${formatMoney(config.maximumCents)}.`;
  }

  return null;
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object") {
    const maybeError = error as {
      response?: { data?: { message?: string } };
      message?: string;
    };
    return maybeError.response?.data?.message || maybeError.message || fallback;
  }

  return fallback;
}

function getWorkspaceCredits(account: WorkspaceBillingAccount | null) {
  return (account?.balance ?? 0) + (account?.effectiveQuota ?? 0);
}

function getTransactionAmountLabel(transaction: WorkspaceBillingTransaction) {
  if (transaction.paymentAmountCents !== null) {
    return formatMoney(transaction.paymentAmountCents);
  }

  if (transaction.type === "quota_grant") {
    return "Included";
  }

  return "—";
}

function getTransactionTitle(transaction: WorkspaceBillingTransaction) {
  return (
    transaction.productName ||
    transaction.description ||
    formatStatusLabel(transaction.type)
  );
}

function getTransactionMeta(transaction: WorkspaceBillingTransaction) {
  if (transaction.invoiceId) {
    return `Invoice ${transaction.invoiceId}`;
  }

  if (transaction.referenceId) {
    return `Reference ${transaction.referenceId}`;
  }

  return formatStatusLabel(transaction.type);
}

function SectionMessage({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-6 text-center">
      <div className="text-sm font-medium text-slate-900">{title}</div>
      <p className="mt-2 text-sm text-slate-500">{description}</p>
    </div>
  );
}

function MobileTableLabel({ children }: { children: string }) {
  return (
    <div className="text-[11px] font-medium uppercase tracking-[0.22em] text-slate-400 md:hidden">
      {children}
    </div>
  );
}

function PlanCard({
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

export function SubscriptionContent({
  workspaceIdFromSearch,
  view,
}: SubscriptionContentProps) {
  const navigate = useNavigate();
  const { selectedWorkspaceId } = useWorkspaceStore();
  const workspaceId = workspaceIdFromSearch || selectedWorkspaceId || undefined;
  const currentView: BillingView = view === "credits" ? "credits" : "plans";

  const { data: workspaces, isLoading: isLoadingWorkspaces } =
    useUserWorkspaces();
  const currentWorkspace = workspaces?.find(
    (workspace) => workspace.id === workspaceId,
  );
  const canManageBilling =
    currentWorkspace?.role === "owner" || currentWorkspace?.role === "admin";

  const overview = useWorkspaceBillingOverview(workspaceId, canManageBilling);
  const checkout = useCreateWorkspaceBillingCheckout(workspaceId);
  const portal = useCreateWorkspaceBillingPortal(workspaceId);

  const creditProducts = overview.data?.creditProducts ?? [];
  const subscriptionProducts = overview.data?.subscriptionProducts ?? [];
  const customAmountProduct =
    creditProducts.find((product) => product.customAmount?.enabled) ?? null;
  const fixedCreditProducts = creditProducts.filter(
    (product) => product.customAmount === undefined,
  );

  const [customAmountInput, setCustomAmountInput] = useState("");
  const [selectedPlanPriceIds, setSelectedPlanPriceIds] = useState<
    Record<string, string>
  >({});

  useEffect(() => {
    if (!customAmountProduct?.customAmount?.enabled) {
      setCustomAmountInput("");
      return;
    }

    const defaultAmountCents =
      customAmountProduct.customAmount.presetCents ??
      customAmountProduct.customAmount.minimumCents ??
      customAmountProduct.amountCents;

    setCustomAmountInput(
      defaultAmountCents ? formatUsdInputValue(defaultAmountCents) : "",
    );
  }, [
    customAmountProduct?.stripePriceId,
    customAmountProduct?.amountCents,
    customAmountProduct?.customAmount?.enabled,
    customAmountProduct?.customAmount?.minimumCents,
    customAmountProduct?.customAmount?.presetCents,
  ]);

  const account = overview.data?.account ?? null;
  const subscription = overview.data?.subscription ?? null;
  const totalCredits = getWorkspaceCredits(account);

  const customAmountConfig = customAmountProduct?.customAmount?.enabled
    ? customAmountProduct.customAmount
    : null;
  const customAmountCents = parseUsdInputToCents(customAmountInput);
  const customAmountError = getCustomAmountError(
    customAmountInput,
    customAmountCents,
    customAmountConfig,
  );
  const customAmountHint = formatCustomAmountRange(customAmountConfig);
  const canSubmitCustomAmount =
    !!customAmountProduct &&
    customAmountCents !== null &&
    !customAmountError &&
    !checkout.isPending;

  const planProducts = [...subscriptionProducts];
  if (
    subscription &&
    !planProducts.some(
      (product) => product.stripePriceId === subscription.product.stripePriceId,
    )
  ) {
    planProducts.unshift(subscription.product);
  }
  const planGroups = groupPlanProducts(planProducts);

  const navigateToView = (nextView: BillingView) => {
    if (!workspaceId) {
      return;
    }

    navigate({
      to: "/subscription",
      search: { workspaceId, view: nextView },
    });
  };

  const handleCheckout = async (
    priceId: string,
    type: "subscription" | "one_time",
    nextView: BillingView,
    amountCents?: number,
  ) => {
    const response = await checkout.mutateAsync({
      priceId,
      type,
      view: nextView,
      amountCents,
    });
    await openExternalUrl(response.checkoutUrl);
  };

  const handleManageBilling = async (nextView: BillingView) => {
    const response = await portal.mutateAsync({ view: nextView });
    await openExternalUrl(response.portalUrl);
  };

  if (!workspaceId) {
    return (
      <main className="flex h-full items-center justify-center bg-background">
        <div className="text-sm text-muted-foreground">
          Select a workspace to manage billing.
        </div>
      </main>
    );
  }

  if (isLoadingWorkspaces) {
    return (
      <main className="flex h-full items-center justify-center bg-background">
        <div className="text-sm text-muted-foreground">
          Loading workspace billing…
        </div>
      </main>
    );
  }

  if (!currentWorkspace) {
    return (
      <main className="flex h-full items-center justify-center bg-background p-6">
        <Card className="w-full max-w-xl">
          <CardContent className="pt-6">
            <SectionMessage
              title="Workspace not found"
              description="Switch to a valid workspace before opening billing."
            />
          </CardContent>
        </Card>
      </main>
    );
  }

  if (!canManageBilling) {
    return (
      <main className="flex h-full items-center justify-center bg-background p-6">
        <Card className="w-full max-w-xl">
          <CardContent className="flex items-start gap-3 pt-6">
            <ShieldAlert className="mt-0.5 h-4 w-4 text-muted-foreground" />
            <div className="space-y-1 text-sm">
              <p className="font-medium text-slate-900">
                Billing access required
              </p>
              <p className="text-muted-foreground">
                Only workspace owners and admins can access recharge and billing
                management for {currentWorkspace.name}.
              </p>
            </div>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (overview.isLoading) {
    return (
      <main className="flex h-full items-center justify-center bg-background">
        <div className="text-sm text-muted-foreground">
          Loading workspace billing…
        </div>
      </main>
    );
  }

  if (overview.error) {
    return (
      <main className="flex h-full items-center justify-center bg-background p-6">
        <Card className="w-full max-w-2xl">
          <CardContent className="pt-6">
            <div className="rounded-md border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {getErrorMessage(
                overview.error,
                "Unable to load workspace billing details.",
              )}
            </div>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (currentView === "credits") {
    const organizationName = account?.ownerName || currentWorkspace.name;
    const currentPlanName = subscription?.product.name || "Free";
    const currentPlanCreditsLabel = subscription
      ? formatPlanCredits(subscription.product)
      : account?.effectiveQuota
        ? `${formatCredits(account.effectiveQuota)} / month`
        : "No active paid subscription";
    const canOpenInvoice = !!overview.data?.recentTransactions.some(
      (transaction) =>
        transaction.paymentAmountCents !== null || transaction.invoiceId,
    );

    return (
      <main className="flex h-full flex-col overflow-hidden bg-[#f4f7fc]">
        <ScrollArea className="min-h-0 flex-1">
          <div className="relative isolate">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.95),transparent_35%),radial-gradient(circle_at_top_right,rgba(230,239,255,0.95),transparent_40%),linear-gradient(180deg,#f9fbff_0%,#eef4fb_100%)]" />

            <div className="relative mx-auto flex w-full max-w-[1120px] flex-col gap-4 px-4 py-5 sm:px-5 lg:px-6">
              <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                <div className="max-w-3xl">
                  <h1 className="text-3xl font-semibold tracking-[-0.05em] text-[#111b35] sm:text-4xl">
                    Organization Credits
                  </h1>
                  <p className="mt-2 text-sm text-[#6a7d9e] sm:text-base">
                    Org Account: {organizationName}
                  </p>
                </div>

                <Button
                  variant="outline"
                  size="icon"
                  className="h-12 w-12 rounded-[1.1rem] border-white/80 bg-white/80 text-[#6a7d9e] shadow-[0_18px_40px_-32px_rgba(15,23,42,0.4)] backdrop-blur"
                  onClick={() => navigateToView("plans")}
                  aria-label="Back to plans"
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>

              <Card className="overflow-hidden rounded-[1.35rem] border-white/75 bg-[linear-gradient(180deg,#ffffff_0%,#f5f9ff_100%)] shadow-[0_24px_72px_-44px_rgba(15,23,42,0.35)]">
                <CardContent className="p-5 sm:p-6">
                  <div className="text-[1.15rem] font-semibold tracking-[-0.03em] text-[#111b35] sm:text-[1.25rem]">
                    Organization Credits
                  </div>
                  <div className="mt-3 text-[2.6rem] leading-none font-semibold tracking-[-0.06em] text-[#111b35] sm:text-[3.2rem]">
                    {formatCredits(totalCredits)}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2.5 text-sm text-[#5d7295]">
                    <div className="rounded-full border border-[#dbe6f6] bg-white/90 px-4 py-2">
                      Prepaid balance: {formatCredits(account?.balance ?? 0)}
                    </div>
                    <div className="rounded-full border border-[#dbe6f6] bg-white/90 px-4 py-2">
                      Plan quota: {formatCredits(account?.effectiveQuota ?? 0)}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="grid gap-5 xl:grid-cols-[1.35fr_0.95fr]">
                <Card className="overflow-hidden rounded-[1.35rem] border-white/75 bg-white/80 shadow-[0_24px_72px_-44px_rgba(15,23,42,0.35)] backdrop-blur">
                  <CardContent className="space-y-4 p-5 sm:p-6">
                    <div>
                      <CardTitle className="text-[1.35rem] tracking-[-0.04em] text-[#111b35] sm:text-[1.45rem]">
                        Buy Credits
                      </CardTitle>
                      <p className="mt-1.5 text-sm text-[#6a7d9e] sm:text-base">
                        Add prepaid credits to your workspace balance.
                      </p>
                    </div>

                    {customAmountConfig ? (
                      <div>
                        <div className="text-sm font-medium text-[#4a5f83]">
                          Amount in USD
                        </div>

                        <div className="mt-3.5 grid gap-3.5 xl:grid-cols-[minmax(0,1fr)_220px_180px]">
                          <div className="rounded-[1.15rem] border border-[#d7e2f2] bg-white px-5 py-4 shadow-[0_16px_36px_-32px_rgba(15,23,42,0.35)]">
                            <div className="relative">
                              <span className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 text-[1.45rem] font-semibold text-[#54698d]">
                                $
                              </span>
                              <Input
                                inputMode="decimal"
                                placeholder={
                                  customAmountConfig.presetCents
                                    ? formatUsdInputValue(
                                        customAmountConfig.presetCents,
                                      )
                                    : "25"
                                }
                                value={customAmountInput}
                                onChange={(event) =>
                                  setCustomAmountInput(event.target.value)
                                }
                                aria-invalid={
                                  customAmountInput.trim().length > 0 &&
                                  !!customAmountError
                                }
                                className="h-auto border-0 bg-transparent pl-7 text-[1.45rem] font-semibold text-[#111b35] shadow-none ring-0 focus-visible:ring-0"
                              />
                            </div>
                          </div>

                          <div className="rounded-[1.15rem] bg-[#f3f6fb] px-5 py-4">
                            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8a9ab8]">
                              You receive
                            </div>
                            <div className="mt-2 text-[1.3rem] font-semibold tracking-[-0.04em] text-[#111b35]">
                              {customAmountCents !== null
                                ? formatCreditsFromCents(customAmountCents)
                                : "—"}
                            </div>
                          </div>

                          <Button
                            className="h-[3.75rem] rounded-[1.05rem] bg-[#3e7df1] text-base font-semibold text-white hover:bg-[#336fe0]"
                            onClick={() =>
                              customAmountProduct && customAmountCents !== null
                                ? void handleCheckout(
                                    customAmountProduct.stripePriceId,
                                    "one_time",
                                    "credits",
                                    customAmountCents,
                                  )
                                : undefined
                            }
                            disabled={!canSubmitCustomAmount}
                          >
                            Add Credits
                          </Button>
                        </div>

                        <p
                          className={cn(
                            "mt-3 text-sm",
                            customAmountInput.trim().length > 0 &&
                              customAmountError
                              ? "text-destructive"
                              : "text-[#6a7d9e]",
                          )}
                        >
                          {customAmountInput.trim().length > 0 &&
                          customAmountError
                            ? customAmountError
                            : customAmountHint ||
                              "1 USD = 1,000 credits across all paid plans."}
                        </p>
                      </div>
                    ) : fixedCreditProducts.length > 0 ? (
                      <div className="rounded-[1.4rem] border border-[#d7e2f2] bg-[#f7faff] px-5 py-4 text-sm text-[#5d7295]">
                        Custom amount top-up is not configured for this
                        workspace yet. Use a quick amount below.
                      </div>
                    ) : (
                      <SectionMessage
                        title="No usable top-up options configured"
                        description="Billing Hub does not currently expose a custom top-up amount or any fixed credit packs."
                      />
                    )}

                    {fixedCreditProducts.length > 0 ? (
                      <div className="space-y-3">
                        <div className="text-sm font-medium text-[#4a5f83]">
                          Quick amounts
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                          {fixedCreditProducts.map((product) => (
                            <button
                              key={product.stripePriceId}
                              type="button"
                              className="rounded-[1rem] border border-[#d7e2f2] bg-white px-4 py-3.5 text-left transition-colors hover:border-[#afc9fb]"
                              onClick={() =>
                                void handleCheckout(
                                  product.stripePriceId,
                                  "one_time",
                                  "credits",
                                )
                              }
                              disabled={checkout.isPending}
                              aria-label={`Add ${formatMoney(product.amountCents)}`}
                            >
                              <div className="text-[1.35rem] font-semibold tracking-[-0.04em] text-[#111b35]">
                                {formatMoney(product.amountCents)}
                              </div>
                              <div className="mt-1.5 text-sm font-medium text-[#4a5f83]">
                                {formatCredits(product.credits ?? 0)}
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <p className="text-base leading-7 text-[#5d7295]">
                      This credit balance is shared across the entire workspace
                      and never expires.
                    </p>
                  </CardContent>
                </Card>

                <Card className="overflow-hidden rounded-[1.35rem] border-white/75 bg-white/80 shadow-[0_24px_72px_-44px_rgba(15,23,42,0.35)] backdrop-blur">
                  <CardContent className="space-y-3.5 p-5 sm:p-6">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8a9ab8]">
                      Current plan
                    </div>
                    <div className="text-[1.65rem] font-semibold tracking-[-0.05em] text-[#111b35]">
                      {currentPlanName}
                    </div>
                    <div className="flex flex-wrap items-center gap-2.5 text-[0.95rem] font-medium text-[#4a5f83]">
                      <span>{currentPlanCreditsLabel}</span>
                      <button
                        type="button"
                        className="text-[#3e7df1] transition-colors hover:text-[#336fe0]"
                        onClick={() => navigateToView("plans")}
                      >
                        Change
                      </button>
                    </div>
                    <p className="text-[0.95rem] leading-6 text-[#6a7d9e]">
                      {getCreditsPlanDescription(currentPlanName)}
                    </p>
                    <p className="text-sm text-[#7d8ead]">
                      {subscription
                        ? `Current period ends ${formatDate(subscription.currentPeriodEnd)}.`
                        : "Workspace billing is attached to the organization, not an individual user."}
                    </p>
                    <Button
                      className="h-11 rounded-[0.95rem] bg-[#3e7df1] px-5 text-base font-semibold text-white hover:bg-[#336fe0]"
                      onClick={() => navigateToView("plans")}
                    >
                      {getCreditsPlanActionLabel(currentPlanName)}
                    </Button>
                  </CardContent>
                </Card>
              </div>

              <div id="credits-history">
                <Card className="overflow-hidden rounded-[1.35rem] border-white/75 bg-white/80 shadow-[0_24px_72px_-44px_rgba(15,23,42,0.35)] backdrop-blur">
                  <CardContent className="p-5 sm:p-6">
                    <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <CardTitle className="text-[1.35rem] tracking-[-0.04em] text-[#111b35] sm:text-[1.45rem]">
                          Recent Transactions
                        </CardTitle>
                        <p className="mt-1.5 text-sm text-[#6a7d9e] sm:text-base">
                          History
                        </p>
                      </div>

                      <div className="inline-flex w-fit items-center rounded-[1.25rem] bg-[#f2f5fa] p-1.5">
                        <div className="rounded-[1rem] bg-white px-5 py-2.5 text-base font-medium text-[#111b35] shadow-[0_10px_26px_-22px_rgba(15,23,42,0.45)]">
                          Transaction history
                        </div>
                        <div className="px-5 py-2.5 text-base font-medium text-[#7e91b2]">
                          Usage history
                        </div>
                      </div>
                    </div>

                    <div className="mt-7">
                      {overview.data?.recentTransactions.length ? (
                        <div className="overflow-hidden rounded-[1.6rem] border border-[#dbe6f6] bg-white">
                          <div className="hidden grid-cols-[1.2fr_0.6fr_0.8fr_0.6fr] gap-4 border-b border-[#dbe6f6] bg-[#f7f9fc] px-6 py-4 text-[0.95rem] font-semibold uppercase tracking-[0.08em] text-[#7d8ead] md:grid">
                            <div>Date</div>
                            <div>Amount</div>
                            <div>Credits</div>
                            <div>Actions</div>
                          </div>

                          {overview.data.recentTransactions.map(
                            (transaction) => {
                              const canManageInvoice =
                                transaction.paymentAmountCents !== null ||
                                !!transaction.invoiceId;

                              return (
                                <div
                                  key={transaction.id}
                                  className="grid gap-4 border-t border-[#edf2f9] px-6 py-5 first:border-t-0 md:grid-cols-[1.2fr_0.6fr_0.8fr_0.6fr] md:items-center"
                                >
                                  <div>
                                    <MobileTableLabel>Date</MobileTableLabel>
                                    <div className="text-[1.05rem] font-medium text-[#111b35]">
                                      {formatDateTime(transaction.createdAt)}
                                    </div>
                                    <div className="mt-1 text-sm text-[#7d8ead]">
                                      {getTransactionTitle(transaction)}
                                    </div>
                                  </div>

                                  <div>
                                    <MobileTableLabel>Amount</MobileTableLabel>
                                    <div className="text-[1.05rem] text-[#243247]">
                                      {getTransactionAmountLabel(transaction)}
                                    </div>
                                  </div>

                                  <div>
                                    <MobileTableLabel>Credits</MobileTableLabel>
                                    <div className="text-[1.05rem] font-medium text-[#243247]">
                                      {formatCredits(transaction.amount)}
                                    </div>
                                  </div>

                                  <div>
                                    <MobileTableLabel>Actions</MobileTableLabel>
                                    {canManageInvoice ? (
                                      <button
                                        type="button"
                                        className="text-[1.05rem] font-medium text-[#3e7df1] transition-colors hover:text-[#336fe0]"
                                        onClick={() =>
                                          void handleManageBilling("credits")
                                        }
                                        disabled={portal.isPending}
                                      >
                                        Get invoice
                                      </button>
                                    ) : (
                                      <div className="text-sm text-[#7d8ead]">
                                        {getTransactionMeta(transaction)}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            },
                          )}
                        </div>
                      ) : (
                        <SectionMessage
                          title="No billing transactions yet"
                          description="Completed recharges, subscriptions, and refunds will appear here."
                        />
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {checkout.error ? (
                <div className="rounded-md border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {getErrorMessage(
                    checkout.error,
                    "Unable to start checkout right now.",
                  )}
                </div>
              ) : null}

              {portal.error && canOpenInvoice ? (
                <div className="rounded-md border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {getErrorMessage(
                    portal.error,
                    "Unable to open billing management right now.",
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </ScrollArea>
      </main>
    );
  }

  return (
    <main className="flex h-full flex-col overflow-hidden bg-[#f4f7fc]">
      <ScrollArea className="min-h-0 flex-1">
        <div className="relative isolate">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.95),transparent_35%),radial-gradient(circle_at_top_right,rgba(230,239,255,0.95),transparent_40%),linear-gradient(180deg,#f9fbff_0%,#eef4fb_100%)]" />

          <div className="relative mx-auto flex w-full max-w-[1120px] flex-col gap-4 px-4 py-5 sm:px-5 lg:px-6">
            {subscription?.cancelAtPeriodEnd ? (
              <div className="rounded-full border border-amber-200 bg-amber-50/90 px-5 py-3 text-sm text-amber-800">
                The current subscription will end on{" "}
                {formatDate(subscription.currentPeriodEnd)}.
              </div>
            ) : null}

            <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
              <div className="max-w-3xl">
                <div className="text-sm font-medium uppercase tracking-[0.22em] text-[#7e91b2]">
                  {currentWorkspace.name} workspace billing
                </div>
                <h1 className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-[#111b35] sm:text-4xl">
                  Choose your plan
                </h1>
                <p className="mt-2 max-w-2xl text-sm text-[#6a7d9e] sm:text-base">
                  Select the plan that fits your workload.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3 xl:justify-end">
                <div className="rounded-full border border-white/80 bg-white/80 px-5 py-3 text-sm font-medium text-[#6a7d9e] shadow-[0_18px_40px_-32px_rgba(15,23,42,0.4)] backdrop-blur">
                  1 USD = 1,000 credits across all plans.
                </div>
                <Button
                  variant="outline"
                  className="h-12 rounded-full border-white/80 bg-white/80 px-5 text-sm font-medium text-[#425675] shadow-[0_18px_40px_-32px_rgba(15,23,42,0.4)]"
                  onClick={() => void handleManageBilling("plans")}
                  disabled={portal.isPending}
                >
                  Manage billing
                </Button>
              </div>
            </div>

            <div className="grid gap-6 xl:grid-cols-3">
              <PlanCard
                badge="Free"
                title="Free"
                priceAmount="$0"
                priceCycle="month"
                description={getPlanDescription("free")}
                features={FREE_PLAN_FEATURES}
                actionLabel={subscription ? "Choose Free" : "Current plan"}
                actionDisabled={!subscription}
                onAction={
                  subscription
                    ? () => {
                        void handleManageBilling("plans");
                      }
                    : undefined
                }
                theme="free"
              />

              {planGroups.map((group, groupIndex) => {
                const defaultProduct =
                  group.products.find(
                    (product) =>
                      product.stripePriceId ===
                      subscription?.product.stripePriceId,
                  ) ?? group.products[0];
                const selectedProduct =
                  group.products.find(
                    (product) =>
                      product.stripePriceId === selectedPlanPriceIds[group.key],
                  ) ?? defaultProduct;
                const cycle = formatInterval(
                  selectedProduct.interval,
                  selectedProduct.intervalCount,
                );
                const isCurrentPlan =
                  subscription?.product.stripePriceId ===
                  selectedProduct.stripePriceId;

                return (
                  <PlanCard
                    key={group.key}
                    badge={group.badge}
                    title={group.title}
                    priceAmount={formatMoney(selectedProduct.amountCents)}
                    priceCycle={cycle}
                    description={getPlanDescription(group.title)}
                    features={buildPlanFeatures(selectedProduct)}
                    actionLabel={
                      isCurrentPlan ? "Current plan" : `Choose ${group.title}`
                    }
                    actionDisabled={isCurrentPlan}
                    onAction={
                      isCurrentPlan
                        ? undefined
                        : () => {
                            void handleCheckout(
                              selectedProduct.stripePriceId,
                              "subscription",
                              "plans",
                            );
                          }
                    }
                    theme={getPlanCardTheme(groupIndex, group.title)}
                    optionItems={group.products.map((product) => ({
                      value: product.stripePriceId,
                      label: formatPlanOptionLabel(product),
                    }))}
                    optionValue={selectedProduct.stripePriceId}
                    onOptionChange={(nextValue) =>
                      setSelectedPlanPriceIds((current) => ({
                        ...current,
                        [group.key]: nextValue,
                      }))
                    }
                  />
                );
              })}
            </div>

            {planGroups.length === 0 ? (
              <SectionMessage
                title="No paid plans configured"
                description="Billing Hub does not currently expose any paid subscription products."
              />
            ) : null}

            <Card className="overflow-hidden rounded-[1.35rem] border-white/70 bg-white/75 shadow-[0_24px_72px_-44px_rgba(15,23,42,0.35)] backdrop-blur">
              <CardContent className="flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="text-sm font-medium uppercase tracking-[0.22em] text-[#7e91b2]">
                    Shared workspace credits
                  </div>
                  <div className="mt-2 text-[1.55rem] font-semibold tracking-[-0.04em] text-[#111b35]">
                    {formatCredits(totalCredits)}
                  </div>
                  <p className="mt-3 max-w-2xl text-sm leading-6 text-[#6a7d9e]">
                    Need a top-up or want to review recent transactions? Open
                    the workspace credits page.
                  </p>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <Button
                    variant="outline"
                    className="h-12 rounded-full border-[#d5dfef] bg-white px-6 text-[#35517d]"
                    onClick={() => navigateToView("credits")}
                  >
                    Manage workspace credits
                  </Button>
                </div>
              </CardContent>
            </Card>

            {checkout.error ? (
              <div className="rounded-md border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {getErrorMessage(
                  checkout.error,
                  "Unable to start checkout right now.",
                )}
              </div>
            ) : null}

            {portal.error ? (
              <div className="rounded-md border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {getErrorMessage(
                  portal.error,
                  "Unable to open billing management right now.",
                )}
              </div>
            ) : null}
          </div>
        </div>
      </ScrollArea>
    </main>
  );
}

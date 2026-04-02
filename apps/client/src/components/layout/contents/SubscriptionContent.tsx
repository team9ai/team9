import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  Coins,
  CreditCard,
  Package,
  ReceiptText,
  ShieldAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
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
  result?: "success" | "cancel";
  view?: BillingView;
}

const FREE_PLAN_FEATURES = [
  "No paid subscription required",
  "Shared workspace billing subject",
  "Upgrade when your team needs more credits",
];

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

function formatPlanPrice(product: BillingProduct) {
  const cycle = formatInterval(product.interval, product.intervalCount);
  return cycle
    ? `${formatMoney(product.amountCents)} / ${cycle}`
    : formatMoney(product.amountCents);
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

function InfoStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
      <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">
        {label}
      </div>
      <div className="mt-2 text-base font-semibold text-slate-950">{value}</div>
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
  price,
  creditsLabel,
  description,
  features,
  actionLabel,
  onAction,
  actionDisabled = false,
  highlighted = false,
}: {
  badge: string;
  title: string;
  price: string;
  creditsLabel: string;
  description: string;
  features: string[];
  actionLabel: string;
  onAction?: () => void;
  actionDisabled?: boolean;
  highlighted?: boolean;
}) {
  return (
    <Card
      className={cn(
        "h-full border-slate-200 shadow-sm",
        highlighted && "border-primary/30 bg-primary/[0.04]",
      )}
    >
      <CardContent className="flex h-full flex-col p-6">
        <Badge
          variant={highlighted ? "default" : "secondary"}
          className="w-fit rounded-full px-3 py-1 text-sm"
        >
          {badge}
        </Badge>

        <div className="mt-5">
          <div className="text-lg font-semibold text-slate-950">{title}</div>
          <div className="text-3xl font-semibold tracking-tight text-slate-950">
            {price}
          </div>
          <div className="mt-3 text-base font-medium text-slate-700">
            {creditsLabel}
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-500">{description}</p>
        </div>

        <Button
          className="mt-6 h-11 w-full"
          variant={highlighted ? "default" : "outline"}
          onClick={onAction}
          disabled={actionDisabled}
        >
          {actionLabel}
        </Button>

        <div className="mt-6 space-y-3">
          {features.map((feature) => (
            <div key={feature} className="flex items-start gap-3 text-sm">
              <Check className="mt-0.5 h-4 w-4 text-primary" />
              <span className="text-slate-600">{feature}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function SubscriptionContent({
  workspaceIdFromSearch,
  result,
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
  planProducts.sort((left, right) => {
    const leftOrder = left.display.sortOrder ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = right.display.sortOrder ?? Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder;
  });

  const bannerMessage =
    result === "success"
      ? "Billing updated. Workspace data is refreshing from Billing Hub."
      : result === "cancel"
        ? "Billing flow was canceled. No changes were applied."
        : null;

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
    return (
      <main className="flex h-full flex-col overflow-hidden bg-background">
        <header className="flex h-14 items-center gap-2 border-b bg-background px-4">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2"
            onClick={() => navigateToView("plans")}
          >
            <ArrowLeft className="h-4 w-4" />
            Back to plans
          </Button>
          <Separator orientation="vertical" className="hidden h-5 sm:block" />
          <div className="min-w-0">
            <h1 className="text-lg font-semibold">Workspace credits</h1>
            <p className="truncate text-xs text-muted-foreground">
              {currentWorkspace.name} · shared across the workspace
            </p>
          </div>
        </header>

        <ScrollArea className="min-h-0 flex-1 bg-secondary/20">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
            {bannerMessage ? (
              <div className="rounded-2xl border border-primary/15 bg-primary/5 px-4 py-3 text-sm text-foreground">
                {bannerMessage}
              </div>
            ) : null}

            <Card className="overflow-hidden border-slate-200 shadow-sm">
              <CardContent className="grid gap-4 p-6 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
                <div>
                  <div className="text-sm font-medium text-slate-600">
                    Shared workspace credits
                  </div>
                  <div className="mt-3 text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
                    {formatCredits(totalCredits)}
                  </div>
                  <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500">
                    Prepaid credits belong to the workspace. Monthly quota comes
                    from the current plan, and top-ups stay available until they
                    are used.
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                  <InfoStat
                    label="Prepaid balance"
                    value={formatCredits(account?.balance ?? 0)}
                  />
                  <InfoStat
                    label="Plan quota"
                    value={formatCredits(account?.effectiveQuota ?? 0)}
                  />
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
              <Card className="border-slate-200 shadow-sm">
                <CardHeader className="space-y-2">
                  <div className="flex items-center gap-2 text-slate-500">
                    <Package className="h-4 w-4" />
                    <span className="text-xs font-medium uppercase tracking-[0.22em]">
                      Recharge
                    </span>
                  </div>
                  <CardTitle className="text-2xl text-slate-950">
                    Buy workspace credits
                  </CardTitle>
                  <p className="text-sm leading-6 text-slate-500">
                    Recharge is charged to the workspace. Only owners and admins
                    can complete the purchase.
                  </p>
                </CardHeader>

                <CardContent className="space-y-4">
                  {customAmountConfig ? (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                      <div className="text-xs font-medium uppercase tracking-[0.22em] text-slate-400">
                        Custom amount
                      </div>

                      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px] lg:items-end">
                        <div>
                          <div className="text-sm font-medium text-slate-900">
                            Amount in USD
                          </div>
                          <div className="relative mt-2">
                            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-lg font-semibold text-slate-500">
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
                              className="h-14 rounded-2xl border-slate-200 bg-white pl-9 text-lg font-semibold text-slate-950"
                            />
                          </div>
                          <p
                            className={cn(
                              "mt-2 text-sm",
                              customAmountInput.trim().length > 0 &&
                                customAmountError
                                ? "text-destructive"
                                : "text-slate-500",
                            )}
                          >
                            {customAmountInput.trim().length > 0 &&
                            customAmountError
                              ? customAmountError
                              : customAmountHint ||
                                "1 USD = 1,000 credits across all paid plans."}
                          </p>
                        </div>

                        <div className="rounded-2xl border border-slate-200 bg-white p-4">
                          <div className="text-xs font-medium uppercase tracking-[0.22em] text-slate-400">
                            You will receive
                          </div>
                          <div className="mt-2 text-2xl font-semibold text-slate-950">
                            {customAmountCents !== null
                              ? formatCreditsFromCents(customAmountCents)
                              : "—"}
                          </div>
                          <Button
                            className="mt-4 h-11 w-full"
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
                            Add credits
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : fixedCreditProducts.length > 0 ? (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-600">
                      Custom amount top-up is not configured for this workspace
                      yet. Use a quick amount below.
                    </div>
                  ) : (
                    <SectionMessage
                      title="No usable top-up options configured"
                      description="Billing Hub does not currently expose a custom top-up amount or any fixed credit packs."
                    />
                  )}

                  {fixedCreditProducts.length > 0 ? (
                    <div className="space-y-3">
                      <div className="text-sm font-medium text-slate-900">
                        Quick amounts
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        {fixedCreditProducts.map((product) => (
                          <button
                            key={product.stripePriceId}
                            type="button"
                            className="rounded-2xl border border-slate-200 bg-white p-4 text-left transition-colors hover:border-slate-300"
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
                            <div className="text-2xl font-semibold text-slate-950">
                              {formatMoney(product.amountCents)}
                            </div>
                            <div className="mt-2 text-sm font-medium text-slate-700">
                              {formatCredits(product.credits ?? 0)}
                            </div>
                            <p className="mt-3 text-sm leading-6 text-slate-500">
                              {product.display.description ||
                                "Prepaid workspace credits that never expire."}
                            </p>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              <Card className="border-slate-200 shadow-sm">
                <CardHeader className="space-y-2">
                  <div className="flex items-center gap-2 text-slate-500">
                    <Coins className="h-4 w-4" />
                    <span className="text-xs font-medium uppercase tracking-[0.22em]">
                      Current plan
                    </span>
                  </div>
                  <CardTitle className="text-2xl text-slate-950">
                    {subscription ? subscription.product.name : "Free"}
                  </CardTitle>
                </CardHeader>

                <CardContent className="space-y-4">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                    <div className="text-base font-semibold text-slate-950">
                      {subscription
                        ? formatPlanCredits(subscription.product)
                        : "No active paid subscription"}
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-500">
                      {subscription?.product.display.description ||
                        "Workspace billing is attached to the workspace, not an individual user."}
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <InfoStat
                      label="Status"
                      value={formatStatusLabel(
                        subscription?.status || account?.status || "active",
                      )}
                    />
                    <InfoStat
                      label={subscription ? "Current period" : "Plan"}
                      value={
                        subscription
                          ? `Ends ${formatDate(subscription.currentPeriodEnd)}`
                          : "Free"
                      }
                    />
                  </div>

                  <div className="flex flex-col gap-3">
                    <Button
                      variant="outline"
                      className="h-11 w-full justify-center"
                      onClick={() => navigateToView("plans")}
                    >
                      Change plan
                    </Button>
                    <Button
                      variant="ghost"
                      className="h-11 w-full justify-center"
                      onClick={() => void handleManageBilling("credits")}
                      disabled={portal.isPending}
                    >
                      <ArrowUpRight className="h-4 w-4" />
                      Open billing portal
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card className="border-slate-200 shadow-sm">
              <CardHeader className="space-y-2">
                <div className="flex items-center gap-2 text-slate-500">
                  <ReceiptText className="h-4 w-4" />
                  <span className="text-xs font-medium uppercase tracking-[0.22em]">
                    History
                  </span>
                </div>
                <CardTitle className="text-2xl text-slate-950">
                  Recent transactions
                </CardTitle>
              </CardHeader>

              <CardContent>
                {overview.data?.recentTransactions.length ? (
                  <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                    <div className="hidden grid-cols-[1.1fr_0.7fr_0.8fr_1.4fr] gap-4 border-b border-slate-200 bg-slate-50 px-4 py-3 text-[11px] font-medium uppercase tracking-[0.22em] text-slate-400 md:grid">
                      <div>Date</div>
                      <div>Amount</div>
                      <div>Credits</div>
                      <div>Details</div>
                    </div>

                    {overview.data.recentTransactions.map((transaction) => (
                      <div
                        key={transaction.id}
                        className="grid gap-4 border-t border-slate-100 px-4 py-4 first:border-t-0 md:grid-cols-[1.1fr_0.7fr_0.8fr_1.4fr] md:items-center"
                      >
                        <div>
                          <MobileTableLabel>Date</MobileTableLabel>
                          <div className="text-sm font-medium text-slate-900">
                            {formatDateTime(transaction.createdAt)}
                          </div>
                        </div>

                        <div>
                          <MobileTableLabel>Amount</MobileTableLabel>
                          <div className="text-sm text-slate-700">
                            {getTransactionAmountLabel(transaction)}
                          </div>
                        </div>

                        <div>
                          <MobileTableLabel>Credits</MobileTableLabel>
                          <div className="text-sm font-medium text-slate-900">
                            {formatCredits(transaction.amount)}
                          </div>
                        </div>

                        <div>
                          <MobileTableLabel>Details</MobileTableLabel>
                          <div className="text-sm font-medium text-slate-900">
                            {getTransactionTitle(transaction)}
                          </div>
                          <div className="mt-1 text-sm text-slate-500">
                            {getTransactionMeta(transaction)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <SectionMessage
                    title="No billing transactions yet"
                    description="Completed recharges, subscriptions, and refunds will appear here."
                  />
                )}
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
        </ScrollArea>
      </main>
    );
  }

  return (
    <main className="flex h-full flex-col overflow-hidden bg-background">
      <header className="flex h-14 items-center gap-3 border-b bg-background px-4">
        <CreditCard size={18} className="text-primary" />
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">Choose your workspace plan</h1>
          <p className="truncate text-xs text-muted-foreground">
            {currentWorkspace.name} · workspace billing
          </p>
        </div>
      </header>

      <Separator />

      <ScrollArea className="min-h-0 flex-1 bg-secondary/20">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-6">
          {bannerMessage ? (
            <div className="rounded-2xl border border-primary/15 bg-primary/5 px-4 py-3 text-sm text-foreground">
              {bannerMessage}
            </div>
          ) : null}

          {subscription?.cancelAtPeriodEnd ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              The current subscription will end on{" "}
              {formatDate(subscription.currentPeriodEnd)}.
            </div>
          ) : null}

          <Card className="border-slate-200 shadow-sm">
            <CardContent className="flex flex-col gap-4 p-6 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="text-3xl font-semibold tracking-tight text-slate-950">
                  Choose the plan that fits your workspace
                </div>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                  Billing is shared across {currentWorkspace.name}. Owners and
                  admins can change the plan or top up prepaid credits for the
                  whole workspace.
                </p>
              </div>

              <div className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600">
                1 USD = 1,000 credits across paid plans
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-6 xl:grid-cols-3">
            <PlanCard
              badge="Free"
              title="Free"
              price="$0 / month"
              creditsLabel="Start with workspace billing enabled"
              description="Best for early exploration and small workspace usage."
              features={FREE_PLAN_FEATURES}
              actionLabel={
                subscription ? "Downgrade in billing" : "Current plan"
              }
              actionDisabled={!subscription}
              onAction={
                subscription
                  ? () => {
                      void handleManageBilling("plans");
                    }
                  : undefined
              }
            />

            {planProducts.map((product) => {
              const isCurrentPlan =
                subscription?.product.stripePriceId === product.stripePriceId;

              return (
                <PlanCard
                  key={product.stripePriceId}
                  badge={product.display.badge || product.name}
                  title={product.name}
                  price={formatPlanPrice(product)}
                  creditsLabel={formatPlanCredits(product)}
                  description={
                    product.display.description ||
                    "Monthly workspace credits managed through Billing Hub."
                  }
                  features={
                    product.display.features.length > 0
                      ? product.display.features.slice(0, 6)
                      : [
                          "Workspace-wide monthly credits",
                          "Shared billing controls for admins",
                          "Upgrade anytime in checkout",
                        ]
                  }
                  actionLabel={isCurrentPlan ? "Current plan" : "Choose plan"}
                  actionDisabled={isCurrentPlan}
                  highlighted={isCurrentPlan}
                  onAction={
                    isCurrentPlan
                      ? undefined
                      : () => {
                          void handleCheckout(
                            product.stripePriceId,
                            "subscription",
                            "plans",
                          );
                        }
                  }
                />
              );
            })}
          </div>

          {planProducts.length === 0 ? (
            <SectionMessage
              title="No paid plans configured"
              description="Billing Hub does not currently expose any paid subscription products."
            />
          ) : null}

          <Card className="border-slate-200 shadow-sm">
            <CardContent className="flex flex-col gap-4 p-6 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="text-sm font-medium text-slate-900">
                  Current shared credits
                </div>
                <div className="mt-2 text-2xl font-semibold text-slate-950">
                  {formatCredits(totalCredits)}
                </div>
                <p className="mt-2 text-sm text-slate-500">
                  Need a top-up or want to review recent transactions? Open the
                  workspace credits page.
                </p>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <Button
                  variant="outline"
                  className="h-11 px-5"
                  onClick={() => navigateToView("credits")}
                >
                  Manage workspace credits
                </Button>
                <Button
                  variant="ghost"
                  className="h-11 px-5"
                  onClick={() => void handleManageBilling("plans")}
                  disabled={portal.isPending}
                >
                  <ArrowUpRight className="h-4 w-4" />
                  Open billing portal
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
      </ScrollArea>
    </main>
  );
}

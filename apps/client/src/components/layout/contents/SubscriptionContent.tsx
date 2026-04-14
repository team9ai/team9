import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import {
  PlanCard,
  buildPlanFeatures,
  formatCredits,
  formatInterval,
  formatMoney,
  formatPlanCredits,
  formatPlanOptionLabel,
  getFreePlanFeatures,
  getPlanCardTheme,
  getPlanDescription,
  groupPlanProducts,
} from "@/components/billing/plan-card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  useCreateWorkspaceBillingCheckout,
  useCreateWorkspaceBillingPortal,
  useWorkspaceBillingOverview,
} from "@/hooks/useWorkspaceBilling";
import { useUserWorkspaces } from "@/hooks/useWorkspace";
import { openExternalUrl } from "@/lib/open-external-url";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/stores";
import {
  formatDate as formatDateLocale,
  formatDateTime as formatDateTimeLocale,
} from "@/lib/date-format";
import type {
  BillingProductCustomAmount,
  WorkspaceBillingAccount,
  WorkspaceBillingTransaction,
} from "@/types/workspace";

type BillingView = "plans" | "credits";

interface SubscriptionContentProps {
  workspaceIdFromSearch?: string;
  view?: BillingView;
}

function formatCreditsFromCents(amountCents: number) {
  return formatCredits(amountCents * 10);
}

function formatDate(value: string) {
  return formatDateLocale(value);
}

function formatDateTime(value: string) {
  return formatDateTimeLocale(value);
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
    return `${formatMoney(config.minimumCents)} - ${formatMoney(config.maximumCents)}`;
  }

  return `Min ${formatMoney(config.minimumCents)}`;
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
  return (
    (account?.balance ?? 0) +
    (account?.effectiveQuota ?? 0) +
    (account?.grantBalance ?? 0)
  );
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
    <div className="rounded-xl border border-dashed border-[#d5dfef] bg-[#f0f4fb]/80 px-5 py-6 text-center">
      <div className="text-sm font-medium text-[#111b35]">{title}</div>
      <p className="mt-2 text-sm text-[#7e91b2]">{description}</p>
    </div>
  );
}

function MobileTableLabel({ children }: { children: string }) {
  return (
    <div className="text-[11px] font-medium uppercase tracking-[0.22em] text-[#7e91b2] md:hidden">
      {children}
    </div>
  );
}

export function SubscriptionContent({
  workspaceIdFromSearch,
  view,
}: SubscriptionContentProps) {
  const { t } = useTranslation("workspace");
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
  const [showSubscriptionRequired, setShowSubscriptionRequired] =
    useState(false);
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
    if (type === "one_time" && !subscription) {
      setShowSubscriptionRequired(true);
      return;
    }

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
    const currentPlanName = subscription?.product.name || "Free";
    const currentPlanCreditsLabel = subscription
      ? formatPlanCredits(subscription.product)
      : account?.effectiveQuota
        ? `${formatCredits(account.effectiveQuota)} / month`
        : "No paid plan";
    const canOpenInvoice = !!overview.data?.recentTransactions.some(
      (transaction) =>
        transaction.paymentAmountCents !== null || transaction.invoiceId,
    );

    return (
      <main className="flex h-full flex-col overflow-hidden bg-[#f4f7fc]">
        <ScrollArea className="min-h-0 flex-1">
          <div className="relative isolate">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.95),transparent_35%),radial-gradient(circle_at_top_right,rgba(230,239,255,0.95),transparent_40%),linear-gradient(180deg,#f9fbff_0%,#eef4fb_100%)]" />

            <div className="relative mx-auto flex w-full max-w-[960px] flex-col gap-5 px-4 pb-6 pt-7 sm:px-5 sm:pt-8 lg:px-6">
              <div className="min-w-0">
                <div className="text-sm font-medium uppercase tracking-[0.22em] text-[#7e91b2]">
                  {account?.ownerName || currentWorkspace.name}
                </div>
                <h1 className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-[#111b35] sm:text-4xl">
                  Workspace Credits
                </h1>
              </div>

              <Card className="overflow-hidden rounded-[1.35rem] border-white/70 bg-white/75 shadow-[0_24px_72px_-44px_rgba(15,23,42,0.35)] backdrop-blur">
                <CardContent className="flex flex-col gap-4 p-5 sm:p-6 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <div className="text-sm font-medium uppercase tracking-[0.22em] text-[#7e91b2]">
                      Total balance
                    </div>
                    <div className="mt-2 text-[2rem] leading-none font-semibold tracking-[-0.06em] text-[#111b35] sm:text-[2.6rem]">
                      {formatCredits(totalCredits)}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                    <span className="rounded-full border border-[#d5dfef] bg-[#f0f4fb] px-3.5 py-1.5 text-xs font-medium text-[#4a6489]">
                      Top-up: {formatCredits(account?.balance ?? 0)}
                    </span>
                    <span className="rounded-full border border-[#d5dfef] bg-[#f0f4fb] px-3.5 py-1.5 text-xs font-medium text-[#4a6489]">
                      Subscription:{" "}
                      {formatCredits(account?.effectiveQuota ?? 0)}
                    </span>
                    <span className="rounded-full border border-[#d5dfef] bg-[#f0f4fb] px-3.5 py-1.5 text-xs font-medium text-[#4a6489]">
                      Grant: {formatCredits(account?.grantBalance ?? 0)}
                    </span>
                  </div>
                </CardContent>
              </Card>

              <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_260px]">
                <Card className="overflow-hidden rounded-[1.35rem] border-white/70 bg-white/75 shadow-[0_24px_72px_-44px_rgba(15,23,42,0.35)] backdrop-blur">
                  <CardContent className="space-y-4 p-5 sm:p-6">
                    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
                      <CardTitle className="text-lg font-semibold tracking-[-0.02em] text-[#111b35]">
                        Buy Credits
                      </CardTitle>
                      {customAmountHint ? (
                        <span className="rounded-full border border-[#d5dfef] bg-[#f0f4fb] px-3 py-1 text-xs font-medium text-[#4a6489]">
                          {customAmountHint}
                        </span>
                      ) : null}
                    </div>

                    {customAmountConfig ? (
                      <div>
                        <div className="grid gap-3 xl:w-fit xl:grid-cols-[180px_190px_140px]">
                          <div className="rounded-xl border border-[#d5dfef] bg-white px-4 py-0 shadow-sm">
                            <div className="relative">
                              <span className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 text-base font-medium text-[#7e91b2]">
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
                                className="h-11 border-0 bg-transparent pl-5 text-base font-medium text-[#111b35] shadow-none ring-0 focus-visible:ring-0"
                              />
                            </div>
                          </div>

                          <div className="rounded-xl border border-[#d5dfef] bg-[#f0f4fb] px-4 py-2">
                            <div className="text-[11px] font-medium uppercase tracking-[0.2em] text-[#7e91b2]">
                              You receive
                            </div>
                            <div className="mt-0.5 text-sm font-semibold tracking-[-0.02em] text-[#111b35]">
                              {customAmountCents !== null
                                ? formatCreditsFromCents(customAmountCents)
                                : "—"}
                            </div>
                          </div>

                          <Button
                            className="h-11 rounded-full border border-black/10 bg-[#151515] px-5 text-sm font-semibold text-white shadow-none hover:bg-black/90"
                            onClick={() => {
                              if (!subscription) {
                                setShowSubscriptionRequired(true);
                                return;
                              }
                              if (
                                customAmountProduct &&
                                customAmountCents !== null
                              ) {
                                void handleCheckout(
                                  customAmountProduct.stripePriceId,
                                  "one_time",
                                  "credits",
                                  customAmountCents,
                                );
                              }
                            }}
                            disabled={
                              subscription ? !canSubmitCustomAmount : false
                            }
                          >
                            Add Credits
                          </Button>
                        </div>

                        <p
                          className={cn(
                            "mt-2 text-xs",
                            customAmountInput.trim().length > 0 &&
                              customAmountError
                              ? "text-destructive"
                              : "text-[#7e91b2]",
                          )}
                        >
                          {customAmountInput.trim().length > 0 &&
                          customAmountError
                            ? customAmountError
                            : "1 USD = 1,000 credits"}
                        </p>
                      </div>
                    ) : fixedCreditProducts.length > 0 ? (
                      <div className="rounded-xl border border-[#d5dfef] bg-[#f0f4fb] px-5 py-4 text-sm text-[#6a7d9e]">
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
                      <div className="flex flex-wrap gap-2.5">
                        {fixedCreditProducts.map((product) => (
                          <Button
                            key={product.stripePriceId}
                            variant="outline"
                            className="h-auto rounded-full border-[#d5dfef] bg-white px-4 py-2.5 shadow-sm transition-all hover:border-[#9db8e2] hover:bg-[#f0f4fb] hover:shadow-md"
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
                            <span className="text-sm font-semibold text-[#111b35]">
                              {formatMoney(product.amountCents)}
                            </span>
                            <span className="ml-1.5 text-xs font-medium text-[#7e91b2]">
                              {formatCredits(product.credits ?? 0)}
                            </span>
                          </Button>
                        ))}
                      </div>
                    ) : null}
                  </CardContent>
                </Card>

                <Card className="overflow-hidden rounded-[1.35rem] border-white/70 bg-white/75 shadow-[0_24px_72px_-44px_rgba(15,23,42,0.35)] backdrop-blur">
                  <CardContent className="space-y-3 p-5 sm:p-6">
                    <div className="text-sm font-medium uppercase tracking-[0.22em] text-[#7e91b2]">
                      Current plan
                    </div>
                    <div className="text-[1.55rem] font-semibold tracking-[-0.04em] text-[#111b35]">
                      {currentPlanName}
                    </div>
                    <div className="text-sm font-medium text-[#6a7d9e]">
                      {currentPlanCreditsLabel}
                    </div>
                    {subscription ? (
                      <p className="text-xs font-medium text-[#7e91b2]">
                        Ends {formatDate(subscription.currentPeriodEnd)}
                      </p>
                    ) : null}
                    <Button
                      variant="outline"
                      className="h-10 rounded-full border-[#d5dfef] bg-white px-5 text-sm font-medium text-[#35517d] hover:bg-[#f0f4fb]"
                      onClick={() => navigateToView("plans")}
                    >
                      {getCreditsPlanActionLabel(currentPlanName)}
                    </Button>
                  </CardContent>
                </Card>
              </div>

              <div id="credits-history">
                <Card className="overflow-hidden rounded-[1.35rem] border-white/70 bg-white/75 shadow-[0_24px_72px_-44px_rgba(15,23,42,0.35)] backdrop-blur">
                  <CardContent className="p-5 sm:p-6">
                    <CardTitle className="text-lg font-semibold tracking-[-0.02em] text-[#111b35]">
                      Recent Transactions
                    </CardTitle>

                    <div className="mt-5">
                      {overview.data?.recentTransactions.length ? (
                        <div className="overflow-hidden rounded-xl border border-[#d5dfef] bg-white">
                          <div className="hidden grid-cols-[1.2fr_0.6fr_0.8fr_0.6fr] gap-4 border-b border-[#e8edf5] bg-[#f0f4fb] px-5 py-3 text-[11px] font-medium uppercase tracking-[0.2em] text-[#7e91b2] md:grid">
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
                                  className="grid gap-3 border-t border-[#e8edf5] px-5 py-3.5 first:border-t-0 md:grid-cols-[1.2fr_0.6fr_0.8fr_0.6fr] md:items-center"
                                >
                                  <div>
                                    <MobileTableLabel>Date</MobileTableLabel>
                                    <div className="text-sm font-medium text-[#111b35]">
                                      {formatDateTime(transaction.createdAt)}
                                    </div>
                                    <div className="mt-1 text-xs text-[#7e91b2]">
                                      {getTransactionTitle(transaction)}
                                    </div>
                                  </div>

                                  <div>
                                    <MobileTableLabel>Amount</MobileTableLabel>
                                    <div className="text-sm text-[#425675]">
                                      {getTransactionAmountLabel(transaction)}
                                    </div>
                                  </div>

                                  <div>
                                    <MobileTableLabel>Credits</MobileTableLabel>
                                    <div className="text-sm font-medium text-[#425675]">
                                      {formatCredits(transaction.amount)}
                                    </div>
                                  </div>

                                  <div>
                                    <MobileTableLabel>Actions</MobileTableLabel>
                                    {canManageInvoice ? (
                                      <Button
                                        variant="link"
                                        className="h-auto p-0 text-sm font-medium text-[#35517d] hover:text-[#111b35]"
                                        onClick={() =>
                                          void handleManageBilling("credits")
                                        }
                                        disabled={portal.isPending}
                                      >
                                        Get invoice
                                      </Button>
                                    ) : (
                                      <div className="text-sm text-[#7e91b2]">
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
                <div className="rounded-xl border border-destructive/20 bg-destructive/10 px-5 py-3.5 text-sm text-destructive">
                  {getErrorMessage(
                    checkout.error,
                    "Unable to start checkout right now.",
                  )}
                </div>
              ) : null}

              {portal.error && canOpenInvoice ? (
                <div className="rounded-xl border border-destructive/20 bg-destructive/10 px-5 py-3.5 text-sm text-destructive">
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
                {t("billing.page.subscriptionEnds", {
                  date: formatDate(subscription.currentPeriodEnd),
                })}
              </div>
            ) : null}

            <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
              <div className="max-w-3xl">
                <div className="text-sm font-medium uppercase tracking-[0.22em] text-[#7e91b2]">
                  {t("billing.page.workspaceBilling", {
                    workspace: currentWorkspace.name,
                  })}
                </div>
                <h1 className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-[#111b35] sm:text-4xl">
                  {t("billing.page.heading")}
                </h1>
                <p className="mt-2 max-w-2xl text-sm text-[#6a7d9e] sm:text-base">
                  {t("billing.page.subheading")}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3 xl:justify-end">
                <div className="rounded-full border border-white/80 bg-white/80 px-5 py-3 text-sm font-medium text-[#6a7d9e] shadow-[0_18px_40px_-32px_rgba(15,23,42,0.4)] backdrop-blur">
                  {t("billing.page.exchangeRate")}
                </div>
                <Button
                  variant="outline"
                  className="h-12 rounded-full border-white/80 bg-white/80 px-5 text-sm font-medium text-[#425675] shadow-[0_18px_40px_-32px_rgba(15,23,42,0.4)]"
                  onClick={() => void handleManageBilling("plans")}
                  disabled={portal.isPending}
                >
                  {t("billing.page.actions.manageBilling")}
                </Button>
              </div>
            </div>

            <div className="grid gap-6 xl:grid-cols-3">
              <PlanCard
                badge={t("billing.plans.free.title")}
                title={t("billing.plans.free.title")}
                priceAmount="$0"
                priceCycle={formatInterval("month", 1)}
                description={getPlanDescription("free")}
                features={getFreePlanFeatures()}
                actionLabel={
                  subscription
                    ? t("billing.page.actions.chooseFree")
                    : t("billing.page.actions.currentPlan")
                }
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
                      isCurrentPlan
                        ? t("billing.page.actions.currentPlan")
                        : t("billing.page.actions.choosePlan", {
                            plan: group.title,
                          })
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
                title={t("billing.page.emptyPaidPlans.title")}
                description={t("billing.page.emptyPaidPlans.description")}
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

      <AlertDialog
        open={showSubscriptionRequired}
        onOpenChange={setShowSubscriptionRequired}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("billing.page.subscriptionRequired.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("billing.page.subscriptionRequired.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("billing.page.subscriptionRequired.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => navigateToView("plans")}>
              {t("billing.page.subscriptionRequired.viewPlans")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}

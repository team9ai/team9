import { useMemo } from "react";
import { CreditCard, ExternalLink, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useWorkspaceStore } from "@/stores";
import { useUserWorkspaces } from "@/hooks/useWorkspace";
import {
  useCreateWorkspaceBillingCheckout,
  useCreateWorkspaceBillingPortal,
  useWorkspaceBillingProducts,
  useWorkspaceBillingSummary,
} from "@/hooks/useWorkspaceBilling";
import { openExternalUrl } from "@/lib/open-external-url";

interface SubscriptionContentProps {
  workspaceIdFromSearch?: string;
  result?: "success" | "cancel";
}

function formatMoney(amountCents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amountCents / 100);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
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

export function SubscriptionContent({
  workspaceIdFromSearch,
  result,
}: SubscriptionContentProps) {
  const { selectedWorkspaceId } = useWorkspaceStore();
  const workspaceId = workspaceIdFromSearch || selectedWorkspaceId || undefined;

  const { data: workspaces, isLoading: isLoadingWorkspaces } =
    useUserWorkspaces();
  const billingSummary = useWorkspaceBillingSummary(workspaceId);
  const billingProducts = useWorkspaceBillingProducts(workspaceId);
  const checkout = useCreateWorkspaceBillingCheckout(workspaceId);
  const portal = useCreateWorkspaceBillingPortal(workspaceId);

  const currentWorkspace = useMemo(
    () => workspaces?.find((workspace) => workspace.id === workspaceId),
    [workspaces, workspaceId],
  );

  const bannerMessage =
    result === "success"
      ? "Checkout completed. Refreshing subscription status from Billing Hub."
      : result === "cancel"
        ? "Checkout was canceled. Subscription status below is still the source of truth."
        : null;

  const handleCheckout = async (priceId: string) => {
    const response = await checkout.mutateAsync({ priceId });
    await openExternalUrl(response.checkoutUrl);
  };

  const handleManageBilling = async () => {
    const response = await portal.mutateAsync();
    await openExternalUrl(response.portalUrl);
  };

  if (!workspaceId) {
    return (
      <main className="h-full flex items-center justify-center bg-background">
        <div className="text-sm text-muted-foreground">
          Select a workspace to manage billing.
        </div>
      </main>
    );
  }

  if (
    isLoadingWorkspaces ||
    billingSummary.isLoading ||
    billingProducts.isLoading
  ) {
    return (
      <main className="h-full flex items-center justify-center bg-background">
        <div className="text-sm text-muted-foreground">
          Loading subscription details...
        </div>
      </main>
    );
  }

  if (billingSummary.error) {
    return (
      <main className="h-full flex items-center justify-center bg-background p-6">
        <Card className="max-w-2xl w-full">
          <CardContent className="pt-6">
            <div className="rounded-md border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {getErrorMessage(
                billingSummary.error,
                "Unable to load workspace billing details.",
              )}
            </div>
          </CardContent>
        </Card>
      </main>
    );
  }

  const managementAllowed = billingSummary.data?.managementAllowed ?? false;
  const subscription = billingSummary.data?.subscription ?? null;
  const products = billingProducts.data ?? [];

  return (
    <main className="h-full flex flex-col overflow-hidden bg-background">
      <header className="h-14 bg-background flex items-center gap-3 px-4 border-b">
        <CreditCard size={18} className="text-primary" />
        <div>
          <h1 className="text-lg font-semibold">Subscription</h1>
          <p className="text-xs text-muted-foreground">
            {currentWorkspace?.name || "Workspace billing"}
          </p>
        </div>
      </header>

      <Separator />

      <ScrollArea className="flex-1 min-h-0 bg-secondary/30">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
          {bannerMessage ? (
            <div className="rounded-md border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-foreground">
              {bannerMessage}
            </div>
          ) : null}

          {!managementAllowed ? (
            <Card>
              <CardContent className="flex items-start gap-3 pt-6">
                <ShieldAlert className="mt-0.5 h-4 w-4 text-muted-foreground" />
                <div className="space-y-1 text-sm">
                  <p className="font-medium">Read-only access</p>
                  <p className="text-muted-foreground">
                    Only workspace owners and admins can purchase or manage a
                    subscription.
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {subscription ? (
            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div className="space-y-2">
                  <CardTitle>{subscription.product.name}</CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">
                      {subscription.product.display.badge ||
                        subscription.status}
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                      {formatMoney(subscription.product.amountCents)}
                      {subscription.product.interval
                        ? ` / ${subscription.product.interval}`
                        : ""}
                    </span>
                  </div>
                </div>
                {managementAllowed ? (
                  <Button
                    onClick={() => void handleManageBilling()}
                    disabled={portal.isPending}
                  >
                    <ExternalLink size={16} className="mr-2" />
                    Manage billing
                  </Button>
                ) : null}
              </CardHeader>
              <CardContent className="space-y-4">
                {subscription.product.display.description ? (
                  <p className="text-sm text-muted-foreground">
                    {subscription.product.display.description}
                  </p>
                ) : null}

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-lg border bg-background px-4 py-3">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">
                      Current period
                    </div>
                    <div className="mt-1 text-sm font-medium">
                      Ends {formatDate(subscription.currentPeriodEnd)}
                    </div>
                  </div>
                  <div className="rounded-lg border bg-background px-4 py-3">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">
                      Status
                    </div>
                    <div className="mt-1 text-sm font-medium">
                      {subscription.status}
                    </div>
                  </div>
                </div>

                {subscription.cancelAtPeriodEnd ? (
                  <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-900">
                    This subscription will cancel at the end of the current
                    billing period.
                  </div>
                ) : null}

                {subscription.product.display.features.length > 0 ? (
                  <div className="space-y-2">
                    <h2 className="text-sm font-medium">Included</h2>
                    <ul className="grid gap-2 md:grid-cols-2">
                      {subscription.product.display.features.map((feature) => (
                        <li
                          key={feature}
                          className="rounded-md border bg-background px-3 py-2 text-sm"
                        >
                          {feature}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {products.map((product) => (
                <Card key={product.stripePriceId} className="h-full">
                  <CardHeader className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <CardTitle>{product.name}</CardTitle>
                      {product.display.badge ? (
                        <Badge>{product.display.badge}</Badge>
                      ) : null}
                    </div>
                    <div className="text-3xl font-semibold tracking-tight">
                      {formatMoney(product.amountCents)}
                      {product.interval ? (
                        <span className="ml-2 text-sm font-normal text-muted-foreground">
                          / {product.interval}
                        </span>
                      ) : null}
                    </div>
                    {product.display.description ? (
                      <p className="text-sm text-muted-foreground">
                        {product.display.description}
                      </p>
                    ) : null}
                  </CardHeader>
                  <CardContent className="flex h-full flex-col justify-between gap-4">
                    <ul className="space-y-2">
                      {product.display.features.map((feature) => (
                        <li
                          key={feature}
                          className="rounded-md border bg-background px-3 py-2 text-sm"
                        >
                          {feature}
                        </li>
                      ))}
                    </ul>

                    {managementAllowed ? (
                      <Button
                        onClick={() =>
                          void handleCheckout(product.stripePriceId)
                        }
                        disabled={checkout.isPending}
                        className="w-full"
                      >
                        Subscribe
                      </Button>
                    ) : null}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

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

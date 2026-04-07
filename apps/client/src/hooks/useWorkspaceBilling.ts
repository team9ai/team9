import { useMutation, useQuery } from "@tanstack/react-query";
import workspaceApi from "@/services/api/workspace";

export function useWorkspaceBillingOverview(
  workspaceId: string | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: ["workspace-billing-overview", workspaceId],
    queryFn: () => workspaceApi.getBillingOverview(workspaceId!),
    enabled: !!workspaceId && enabled,
  });
}

export function useWorkspaceBillingProducts(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["workspace-billing-products", workspaceId],
    queryFn: () => workspaceApi.getBillingProducts(workspaceId!),
    enabled: !!workspaceId,
  });
}

export function useWorkspaceBillingSummary(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["workspace-billing-summary", workspaceId],
    queryFn: () => workspaceApi.getBillingSubscription(workspaceId!),
    enabled: !!workspaceId,
  });
}

export function useCreateWorkspaceBillingCheckout(
  workspaceId: string | undefined,
) {
  return useMutation({
    mutationFn: ({
      priceId,
      type,
      view,
      amountCents,
      successPath,
      cancelPath,
    }: {
      priceId: string;
      type?: "subscription" | "one_time";
      view?: "plans" | "credits";
      amountCents?: number;
      successPath?: string;
      cancelPath?: string;
    }) =>
      workspaceApi.createBillingCheckout(
        workspaceId!,
        priceId,
        type,
        view,
        amountCents,
        successPath,
        cancelPath,
      ),
  });
}

export function useCreateWorkspaceBillingPortal(
  workspaceId: string | undefined,
) {
  return useMutation({
    mutationFn: ({
      view,
      returnPath,
    }: {
      view?: "plans" | "credits";
      returnPath?: string;
    } = {}) => workspaceApi.createBillingPortal(workspaceId!, view, returnPath),
  });
}

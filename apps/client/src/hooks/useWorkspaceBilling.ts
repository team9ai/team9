import { useMutation, useQuery } from "@tanstack/react-query";
import workspaceApi from "@/services/api/workspace";

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
    mutationFn: ({ priceId }: { priceId: string }) =>
      workspaceApi.createBillingCheckout(workspaceId!, priceId),
  });
}

export function useCreateWorkspaceBillingPortal(
  workspaceId: string | undefined,
) {
  return useMutation({
    mutationFn: () => workspaceApi.createBillingPortal(workspaceId!),
  });
}

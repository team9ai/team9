import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { wikisApi } from "@/services/api/wikis";
import { wikiKeys } from "./useWikis";

/**
 * List proposals for a Wiki. The backend treats an omitted `status` query
 * param as "all"; we default to `"pending"` here because the typical UI
 * surface (review queue) only cares about open proposals. Pass a specific
 * status (e.g. `"approved"`, `"rejected"`) to narrow the scope. Prefix-based
 * invalidation via `wikiKeys.proposals(wikiId)` (no status) still flushes
 * every cached status variant.
 */
export function useWikiProposals(
  wikiId: string | null,
  status: string = "pending",
) {
  return useQuery({
    queryKey: wikiId
      ? wikiKeys.proposals(wikiId, status)
      : (["wikis", "proposals", "disabled"] as const),
    queryFn: () => wikisApi.listProposals(wikiId!, status),
    enabled: !!wikiId,
  });
}

export function useApproveProposal(wikiId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (proposalId: string) =>
      wikisApi.approveProposal(wikiId, proposalId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: wikiKeys.proposals(wikiId) });
    },
  });
}

export function useRejectProposal(wikiId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { proposalId: string; reason?: string }) =>
      wikisApi.rejectProposal(wikiId, input.proposalId, input.reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: wikiKeys.proposals(wikiId) });
    },
  });
}

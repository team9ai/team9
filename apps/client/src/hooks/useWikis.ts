import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  wikisApi,
  type CreateWikiInput,
  type UpdateWikiInput,
} from "@/services/api/wikis";

/**
 * Canonical query-key factory for every Wiki-related query. Keeping the keys
 * in one place makes invalidation sites grep-able — `wikiKeys.proposals(id)`
 * is a single source of truth that both the `useWikiProposals` query and the
 * `useApproveProposal` / `useRejectProposal` mutations reference.
 */
export const wikiKeys = {
  all: ["wikis"] as const,
  detail: (id: string) => ["wikis", id] as const,
  /** Prefix for every tree query under a wiki. Use for prefix-based invalidation. */
  trees: (id: string) => ["wikis", id, "tree"] as const,
  tree: (id: string, path: string) => ["wikis", id, "tree", path] as const,
  /** Prefix for every page query under a wiki. Use for prefix-based invalidation. */
  pages: (id: string) => ["wikis", id, "page"] as const,
  page: (id: string, path: string) => ["wikis", id, "page", path] as const,
  /**
   * Without `status` → prefix that matches every status variant (for
   * invalidation). With `status` → concrete key used by the
   * `useWikiProposals` query.
   */
  proposals: (id: string, status?: string) =>
    status
      ? (["wikis", id, "proposals", status] as const)
      : (["wikis", id, "proposals"] as const),
  /**
   * Diff summary for a single proposal. Scoped under the proposal so a
   * `proposals` invalidation also busts the diff cache automatically.
   */
  proposalDiff: (id: string, proposalId: string) =>
    ["wikis", id, "proposals", "diff", proposalId] as const,
  /**
   * Aggregated pending-proposal counts across every wiki in the active
   * workspace. Flat (no id) — one cache entry per workspace.
   */
  pendingCounts: () => ["wikis", "pending-counts"] as const,
};

export function useWikis() {
  return useQuery({
    queryKey: wikiKeys.all,
    queryFn: () => wikisApi.list(),
  });
}

export function useCreateWiki() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateWikiInput) => wikisApi.create(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: wikiKeys.all });
    },
  });
}

export function useUpdateWiki(wikiId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: UpdateWikiInput) => wikisApi.update(wikiId, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: wikiKeys.all });
      queryClient.invalidateQueries({ queryKey: wikiKeys.detail(wikiId) });
    },
  });
}

export function useArchiveWiki() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (wikiId: string) => wikisApi.archive(wikiId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: wikiKeys.all });
    },
  });
}

/**
 * Aggregated pending-proposal counts across every wiki in the active
 * workspace. One HTTP round-trip instead of N (where N = number of wikis).
 * Sum the values for the workspace-wide badge; look up per-wiki values by
 * `wikiId` for per-row badges. `refetchOnWindowFocus` stays on so a user
 * returning to the tab sees fresh counts without an explicit invalidate.
 */
export function useWikiPendingCounts() {
  return useQuery({
    queryKey: wikiKeys.pendingCounts(),
    queryFn: () => wikisApi.getPendingCounts(),
    refetchOnWindowFocus: true,
  });
}

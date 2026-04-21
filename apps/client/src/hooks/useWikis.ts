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
  tree: (id: string, path: string) => ["wikis", id, "tree", path] as const,
  page: (id: string, path: string) => ["wikis", id, "page", path] as const,
  proposals: (id: string) => ["wikis", id, "proposals"] as const,
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

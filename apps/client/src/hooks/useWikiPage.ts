import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { wikisApi } from "@/services/api/wikis";
import type { CommitPageInput } from "@/types/wiki";
import { wikiKeys } from "./useWikis";

/**
 * Fetch a single Wiki page. Disabled unless both `wikiId` and `path` are
 * non-null so callers can safely render the hook inside components that boot
 * before either value is known.
 */
export function useWikiPage(wikiId: string | null, path: string | null) {
  return useQuery({
    queryKey:
      wikiId && path
        ? wikiKeys.page(wikiId, path)
        : (["wikis", "page", "disabled"] as const),
    queryFn: () => wikisApi.getPage(wikiId!, path!),
    enabled: !!wikiId && !!path,
  });
}

/**
 * Commit a batch of file changes to a Wiki. On success invalidates the tree
 * (so newly created directories/files show up) and every affected page path
 * (so open editors/readers refresh to the committed revision).
 */
export function useCommitWikiPage(wikiId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CommitPageInput) => wikisApi.commit(wikiId, dto),
    onSuccess: (_res, variables) => {
      queryClient.invalidateQueries({ queryKey: wikiKeys.tree(wikiId, "/") });
      for (const file of variables.files) {
        queryClient.invalidateQueries({
          queryKey: wikiKeys.page(wikiId, file.path),
        });
      }
    },
  });
}

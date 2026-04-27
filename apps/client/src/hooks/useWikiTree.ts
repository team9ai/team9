import { useQuery } from "@tanstack/react-query";
import { wikisApi } from "@/services/api/wikis";
import { wikiKeys } from "./useWikis";

/**
 * Fetch the directory tree for a Wiki. Disabled when `wikiId` is null so the
 * hook is safe to call inside components that render before a Wiki is
 * selected. Recursive by default so the sub-sidebar can render the full tree
 * in one shot.
 */
export function useWikiTree(wikiId: string | null, path: string = "/") {
  return useQuery({
    queryKey: wikiId
      ? wikiKeys.tree(wikiId, path)
      : (["wikis", "tree", "disabled"] as const),
    queryFn: () => wikisApi.getTree(wikiId!, { path, recursive: true }),
    enabled: !!wikiId,
  });
}

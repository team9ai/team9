import { useQuery } from "@tanstack/react-query";
import { messageRelationsApi } from "@/services/api/properties";
import { relationKeys } from "@/lib/query-client";

export interface UseViewTreeOptions {
  filter?: unknown;
  sort?: unknown;
  maxDepth?: number;
  limit?: number;
  expandedIds: string[];
  cursor?: string | null;
}

export function useViewTree(
  channelId: string,
  viewId: string,
  opts: UseViewTreeOptions,
) {
  return useQuery({
    queryKey: [
      ...relationKeys.viewTree(channelId, viewId),
      opts.filter,
      opts.sort,
      opts.maxDepth,
      opts.expandedIds.join(","),
      opts.cursor ?? null,
    ],
    queryFn: () =>
      messageRelationsApi.getViewTree(channelId, viewId, {
        maxDepth: opts.maxDepth,
        expandedIds: opts.expandedIds,
        cursor: opts.cursor,
        limit: opts.limit,
        filter: opts.filter,
        sort: opts.sort,
      }),
    enabled: !!channelId && !!viewId,
  });
}

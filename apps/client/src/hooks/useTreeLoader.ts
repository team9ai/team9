import { useCallback, useEffect, useState } from "react";
import { useViewTree } from "./useViewTree";
import wsService from "@/services/websocket";
import type { TreeNode } from "@/types/relations";

export interface UseTreeLoaderParams {
  channelId: string;
  viewId: string;
  filter?: unknown;
  sort?: unknown;
  defaultDepth: number;
}

export interface UseTreeLoaderResult {
  nodes: TreeNode[];
  ancestorsIncluded: string[];
  expand: (nodeId: string) => void;
  collapse: (nodeId: string) => void;
  loadMoreRoots: () => void;
  isLoading: boolean;
  expandedSet: Set<string>;
}

export function useTreeLoader(
  params: UseTreeLoaderParams,
): UseTreeLoaderResult {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [extraExpands, setExtraExpands] = useState<string[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);

  const queryRes = useViewTree(params.channelId, params.viewId, {
    filter: params.filter,
    sort: params.sort,
    maxDepth: params.defaultDepth,
    limit: 50,
    cursor,
    expandedIds: extraExpands,
  });

  useEffect(() => {
    const offChange = wsService.onRelationChanged((e) => {
      if (e.channelId !== params.channelId) return;
      void queryRes.refetch();
    });
    const offPurge = wsService.onRelationsPurged((e) => {
      if (e.channelId !== params.channelId) return;
      void queryRes.refetch();
    });
    return () => {
      offChange();
      offPurge();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.channelId]);

  const expand = useCallback((nodeId: string) => {
    setExpanded((s) => new Set([...s, nodeId]));
    setExtraExpands((xs) => (xs.includes(nodeId) ? xs : [...xs, nodeId]));
  }, []);

  const collapse = useCallback((nodeId: string) => {
    setExpanded((s) => {
      const n = new Set(s);
      n.delete(nodeId);
      return n;
    });
  }, []);

  const loadMoreRoots = useCallback(() => {
    if (queryRes.data?.nextCursor) {
      setCursor(queryRes.data.nextCursor);
    }
  }, [queryRes.data?.nextCursor]);

  return {
    nodes: queryRes.data?.nodes ?? [],
    ancestorsIncluded: queryRes.data?.ancestorsIncluded ?? [],
    expand,
    collapse,
    loadMoreRoots,
    isLoading: queryRes.isLoading,
    expandedSet: expanded,
  };
}

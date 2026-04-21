import { QueryClient } from "@tanstack/react-query";

// ==================== Relation Query Keys ====================

export const relationKeys = {
  all: ["relations"] as const,
  byMessage: (messageId: string) => ["relations", messageId] as const,
  inbound: (messageId: string) => ["relations-inbound", messageId] as const,
  viewTree: (channelId: string, viewId: string) =>
    ["view-tree", channelId, viewId] as const,
};

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 10, // 10 minutes (formerly cacheTime)
      retry: 1,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false, // Handled manually by WebSocket service's refreshQueriesAfterReconnect()
    },
    mutations: {
      retry: 0,
    },
  },
});

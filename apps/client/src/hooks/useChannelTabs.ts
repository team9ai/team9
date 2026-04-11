import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import wsService from "@/services/websocket";
import { tabsApi } from "@/services/api/views";
import type {
  ChannelTab,
  CreateTabDto,
  UpdateTabDto,
} from "@/types/properties";
import type {
  TabCreatedEvent,
  TabUpdatedEvent,
  TabDeletedEvent,
} from "@/types/ws-events";

// ==================== Query Keys ====================

export const channelTabKeys = {
  all: (channelId: string) => ["channel", channelId, "tabs"] as const,
};

// ==================== Query Hook ====================

export function useChannelTabs(channelId: string | undefined) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: channelTabKeys.all(channelId!),
    queryFn: () => tabsApi.getTabs(channelId!),
    enabled: !!channelId,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (!channelId) return;

    const handleCreated = (event: TabCreatedEvent) => {
      if (event.channelId !== channelId) return;
      queryClient.invalidateQueries({
        queryKey: channelTabKeys.all(channelId),
      });
    };

    const handleUpdated = (event: TabUpdatedEvent) => {
      if (event.channelId !== channelId) return;
      queryClient.invalidateQueries({
        queryKey: channelTabKeys.all(channelId),
      });
    };

    const handleDeleted = (event: TabDeletedEvent) => {
      if (event.channelId !== channelId) return;
      queryClient.invalidateQueries({
        queryKey: channelTabKeys.all(channelId),
      });
    };

    wsService.onTabCreated(handleCreated);
    wsService.onTabUpdated(handleUpdated);
    wsService.onTabDeleted(handleDeleted);

    return () => {
      wsService.offTabCreated(handleCreated);
      wsService.offTabUpdated(handleUpdated);
      wsService.offTabDeleted(handleDeleted);
    };
  }, [channelId, queryClient]);

  return query;
}

// ==================== Mutation Hooks ====================

export function useCreateTab(channelId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateTabDto) => tabsApi.createTab(channelId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: channelTabKeys.all(channelId),
      });
    },
  });
}

export function useUpdateTab(channelId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ tabId, data }: { tabId: string; data: UpdateTabDto }) =>
      tabsApi.updateTab(channelId, tabId, data),
    onMutate: async ({ tabId, data }) => {
      await queryClient.cancelQueries({
        queryKey: channelTabKeys.all(channelId),
      });

      const previous = queryClient.getQueryData<ChannelTab[]>(
        channelTabKeys.all(channelId),
      );

      if (previous) {
        queryClient.setQueryData<ChannelTab[]>(
          channelTabKeys.all(channelId),
          previous.map((tab) => (tab.id === tabId ? { ...tab, ...data } : tab)),
        );
      }

      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          channelTabKeys.all(channelId),
          context.previous,
        );
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: channelTabKeys.all(channelId),
      });
    },
  });
}

export function useDeleteTab(channelId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (tabId: string) => tabsApi.deleteTab(channelId, tabId),
    onMutate: async (tabId) => {
      await queryClient.cancelQueries({
        queryKey: channelTabKeys.all(channelId),
      });

      const previous = queryClient.getQueryData<ChannelTab[]>(
        channelTabKeys.all(channelId),
      );

      if (previous) {
        queryClient.setQueryData<ChannelTab[]>(
          channelTabKeys.all(channelId),
          previous.filter((tab) => tab.id !== tabId),
        );
      }

      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          channelTabKeys.all(channelId),
          context.previous,
        );
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: channelTabKeys.all(channelId),
      });
    },
  });
}

export function useReorderTabs(channelId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (tabIds: string[]) => tabsApi.reorderTabs(channelId, tabIds),
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: channelTabKeys.all(channelId),
      });
    },
  });
}

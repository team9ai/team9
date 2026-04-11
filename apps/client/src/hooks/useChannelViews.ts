import { useEffect } from "react";
import {
  useQuery,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import wsService from "@/services/websocket";
import { viewsApi } from "@/services/api/views";
import type {
  ChannelView,
  CreateViewDto,
  UpdateViewDto,
  ViewMessageParams,
  ViewMessagesFlatResponse,
} from "@/types/properties";
import type {
  ViewCreatedEvent,
  ViewUpdatedEvent,
  ViewDeletedEvent,
} from "@/types/ws-events";

// ==================== Query Keys ====================

export const channelViewKeys = {
  all: (channelId: string) => ["channel", channelId, "views"] as const,
  messages: (channelId: string, viewId: string) =>
    ["channel", channelId, "views", viewId, "messages"] as const,
};

// ==================== Query Hooks ====================

export function useChannelViews(channelId: string | undefined) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: channelViewKeys.all(channelId!),
    queryFn: () => viewsApi.getViews(channelId!),
    enabled: !!channelId,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (!channelId) return;

    const handleCreated = (event: ViewCreatedEvent) => {
      if (event.channelId !== channelId) return;
      queryClient.invalidateQueries({
        queryKey: channelViewKeys.all(channelId),
      });
    };

    const handleUpdated = (event: ViewUpdatedEvent) => {
      if (event.channelId !== channelId) return;
      queryClient.invalidateQueries({
        queryKey: channelViewKeys.all(channelId),
      });
    };

    const handleDeleted = (event: ViewDeletedEvent) => {
      if (event.channelId !== channelId) return;
      queryClient.invalidateQueries({
        queryKey: channelViewKeys.all(channelId),
      });
    };

    wsService.onViewCreated(handleCreated);
    wsService.onViewUpdated(handleUpdated);
    wsService.onViewDeleted(handleDeleted);

    return () => {
      wsService.offViewCreated(handleCreated);
      wsService.offViewUpdated(handleUpdated);
      wsService.offViewDeleted(handleDeleted);
    };
  }, [channelId, queryClient]);

  return query;
}

export function useViewMessages(
  channelId: string | undefined,
  viewId: string | undefined,
  params?: ViewMessageParams,
) {
  return useQuery({
    queryKey: [...channelViewKeys.messages(channelId!, viewId!), params],
    queryFn: () => viewsApi.getViewMessages(channelId!, viewId!, params),
    enabled: !!channelId && !!viewId,
    staleTime: 60 * 1000,
  });
}

export function useViewMessagesInfinite(
  channelId: string | undefined,
  viewId: string | undefined,
  params?: Omit<ViewMessageParams, "cursor">,
) {
  return useInfiniteQuery<ViewMessagesFlatResponse>({
    queryKey: [
      ...channelViewKeys.messages(channelId!, viewId!),
      "infinite",
      params,
    ],
    queryFn: async ({ pageParam }) => {
      const result = await viewsApi.getViewMessages(channelId!, viewId!, {
        ...params,
        cursor: pageParam as string | undefined,
      });
      // Normalize: if grouped response, flatten (infinite scroll uses flat)
      if ("groups" in result) {
        return {
          messages: result.groups.flatMap((g) => g.messages),
          total: result.total,
          cursor: null,
        };
      }
      return result;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.cursor ?? undefined,
    enabled: !!channelId && !!viewId,
    staleTime: 60 * 1000,
  });
}

// ==================== Mutation Hooks ====================

export function useCreateView(channelId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateViewDto) => viewsApi.createView(channelId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: channelViewKeys.all(channelId),
      });
    },
  });
}

export function useUpdateView(channelId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ viewId, data }: { viewId: string; data: UpdateViewDto }) =>
      viewsApi.updateView(channelId, viewId, data),
    onMutate: async ({ viewId, data }) => {
      await queryClient.cancelQueries({
        queryKey: channelViewKeys.all(channelId),
      });

      const previous = queryClient.getQueryData<ChannelView[]>(
        channelViewKeys.all(channelId),
      );

      if (previous) {
        queryClient.setQueryData<ChannelView[]>(
          channelViewKeys.all(channelId),
          previous.map((view) =>
            view.id === viewId ? { ...view, ...data } : view,
          ),
        );
      }

      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          channelViewKeys.all(channelId),
          context.previous,
        );
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: channelViewKeys.all(channelId),
      });
    },
  });
}

export function useDeleteView(channelId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (viewId: string) => viewsApi.deleteView(channelId, viewId),
    onMutate: async (viewId) => {
      await queryClient.cancelQueries({
        queryKey: channelViewKeys.all(channelId),
      });

      const previous = queryClient.getQueryData<ChannelView[]>(
        channelViewKeys.all(channelId),
      );

      if (previous) {
        queryClient.setQueryData<ChannelView[]>(
          channelViewKeys.all(channelId),
          previous.filter((view) => view.id !== viewId),
        );
      }

      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          channelViewKeys.all(channelId),
          context.previous,
        );
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: channelViewKeys.all(channelId),
      });
    },
  });
}

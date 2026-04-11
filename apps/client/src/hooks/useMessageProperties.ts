import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import wsService from "@/services/websocket";
import { messagePropertiesApi } from "@/services/api/properties";
import type { BatchSetPropertyEntry } from "@/types/properties";
import type { MessagePropertyChangedEvent } from "@/types/ws-events";

// ==================== Query Keys ====================

export const messagePropertyKeys = {
  all: (messageId: string) => ["message", messageId, "properties"] as const,
};

// ==================== Query Hook ====================

export function useMessageProperties(
  messageId: string | undefined,
  channelId: string | undefined,
) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: messagePropertyKeys.all(messageId!),
    queryFn: () => messagePropertiesApi.getMessageProperties(messageId!),
    enabled: !!messageId,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (!messageId || !channelId) return;

    const handleChanged = (event: MessagePropertyChangedEvent) => {
      if (event.messageId !== messageId) return;
      queryClient.invalidateQueries({
        queryKey: messagePropertyKeys.all(messageId),
      });
    };

    wsService.onMessagePropertyChanged(handleChanged);

    return () => {
      wsService.offMessagePropertyChanged(handleChanged);
    };
  }, [messageId, channelId, queryClient]);

  return query;
}

// ==================== Mutation Hooks ====================

export function useSetProperty(messageId: string, channelId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      definitionId,
      value,
    }: {
      definitionId: string;
      value: unknown;
    }) => messagePropertiesApi.setProperty(messageId, definitionId, value),
    onMutate: async ({ definitionId, value }) => {
      await queryClient.cancelQueries({
        queryKey: messagePropertyKeys.all(messageId),
      });

      const previous = queryClient.getQueryData<Record<string, unknown>>(
        messagePropertyKeys.all(messageId),
      );

      if (previous) {
        queryClient.setQueryData<Record<string, unknown>>(
          messagePropertyKeys.all(messageId),
          { ...previous, [definitionId]: value },
        );
      }

      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          messagePropertyKeys.all(messageId),
          context.previous,
        );
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: messagePropertyKeys.all(messageId),
      });
      // Also invalidate messages query so properties are refreshed in chat view
      queryClient.invalidateQueries({
        queryKey: ["messages", channelId],
      });
    },
  });
}

export function useRemoveProperty(messageId: string, channelId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (definitionId: string) =>
      messagePropertiesApi.removeProperty(messageId, definitionId),
    onMutate: async (definitionId) => {
      await queryClient.cancelQueries({
        queryKey: messagePropertyKeys.all(messageId),
      });

      const previous = queryClient.getQueryData<Record<string, unknown>>(
        messagePropertyKeys.all(messageId),
      );

      if (previous) {
        const updated = { ...previous };
        delete updated[definitionId];
        queryClient.setQueryData<Record<string, unknown>>(
          messagePropertyKeys.all(messageId),
          updated,
        );
      }

      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          messagePropertyKeys.all(messageId),
          context.previous,
        );
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: messagePropertyKeys.all(messageId),
      });
      queryClient.invalidateQueries({
        queryKey: ["messages", channelId],
      });
    },
  });
}

export function useBatchSetProperties(messageId: string, channelId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (properties: BatchSetPropertyEntry[]) =>
      messagePropertiesApi.batchSetProperties(messageId, properties),
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: messagePropertyKeys.all(messageId),
      });
      queryClient.invalidateQueries({
        queryKey: ["messages", channelId],
      });
    },
  });
}

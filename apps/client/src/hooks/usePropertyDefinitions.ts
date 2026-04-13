import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import wsService from "@/services/websocket";
import { propertyDefinitionsApi } from "@/services/api/properties";
import type {
  PropertyDefinition,
  CreatePropertyDefinitionDto,
  UpdatePropertyDefinitionDto,
} from "@/types/properties";
import type {
  PropertyDefinitionCreatedEvent,
  PropertyDefinitionUpdatedEvent,
  PropertyDefinitionDeletedEvent,
} from "@/types/ws-events";

// ==================== Query Keys ====================

export const propertyDefinitionKeys = {
  all: (channelId: string) =>
    ["channel", channelId, "propertyDefinitions"] as const,
};

// ==================== Query Hook ====================

export function usePropertyDefinitions(channelId: string | undefined) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: propertyDefinitionKeys.all(channelId!),
    queryFn: () => propertyDefinitionsApi.getDefinitions(channelId!),
    enabled: !!channelId,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (!channelId) return;

    const handleCreated = (event: PropertyDefinitionCreatedEvent) => {
      if (event.channelId !== channelId) return;
      queryClient.invalidateQueries({
        queryKey: propertyDefinitionKeys.all(channelId),
      });
    };

    const handleUpdated = (event: PropertyDefinitionUpdatedEvent) => {
      if (event.channelId !== channelId) return;
      queryClient.invalidateQueries({
        queryKey: propertyDefinitionKeys.all(channelId),
      });
    };

    const handleDeleted = (event: PropertyDefinitionDeletedEvent) => {
      if (event.channelId !== channelId) return;
      queryClient.invalidateQueries({
        queryKey: propertyDefinitionKeys.all(channelId),
      });
    };

    wsService.onPropertyDefinitionCreated(handleCreated);
    wsService.onPropertyDefinitionUpdated(handleUpdated);
    wsService.onPropertyDefinitionDeleted(handleDeleted);

    return () => {
      wsService.offPropertyDefinitionCreated(handleCreated);
      wsService.offPropertyDefinitionUpdated(handleUpdated);
      wsService.offPropertyDefinitionDeleted(handleDeleted);
    };
  }, [channelId, queryClient]);

  return query;
}

// ==================== Mutation Hooks ====================

export function useCreatePropertyDefinition(channelId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreatePropertyDefinitionDto) =>
      propertyDefinitionsApi.createDefinition(channelId, data),
    onSuccess: (newDef) => {
      // Write the new definition into the query cache synchronously so that
      // consumers relying on `usePropertyDefinitions` (e.g. inline selection
      // after quick-create in PropertySelector) see it immediately, without
      // waiting for the invalidation refetch to round-trip.
      queryClient.setQueryData<PropertyDefinition[]>(
        propertyDefinitionKeys.all(channelId),
        (old) => (old ? [...old, newDef] : [newDef]),
      );
      queryClient.invalidateQueries({
        queryKey: propertyDefinitionKeys.all(channelId),
      });
    },
  });
}

export function useUpdatePropertyDefinition(channelId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      definitionId,
      data,
    }: {
      definitionId: string;
      data: UpdatePropertyDefinitionDto;
    }) =>
      propertyDefinitionsApi.updateDefinition(channelId, definitionId, data),
    onMutate: async ({ definitionId, data }) => {
      await queryClient.cancelQueries({
        queryKey: propertyDefinitionKeys.all(channelId),
      });

      const previous = queryClient.getQueryData<PropertyDefinition[]>(
        propertyDefinitionKeys.all(channelId),
      );

      if (previous) {
        queryClient.setQueryData<PropertyDefinition[]>(
          propertyDefinitionKeys.all(channelId),
          previous.map((def) =>
            def.id === definitionId ? { ...def, ...data } : def,
          ),
        );
      }

      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          propertyDefinitionKeys.all(channelId),
          context.previous,
        );
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: propertyDefinitionKeys.all(channelId),
      });
    },
  });
}

export function useDeletePropertyDefinition(channelId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (definitionId: string) =>
      propertyDefinitionsApi.deleteDefinition(channelId, definitionId),
    onMutate: async (definitionId) => {
      await queryClient.cancelQueries({
        queryKey: propertyDefinitionKeys.all(channelId),
      });

      const previous = queryClient.getQueryData<PropertyDefinition[]>(
        propertyDefinitionKeys.all(channelId),
      );

      if (previous) {
        queryClient.setQueryData<PropertyDefinition[]>(
          propertyDefinitionKeys.all(channelId),
          previous.filter((def) => def.id !== definitionId),
        );
      }

      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          propertyDefinitionKeys.all(channelId),
          context.previous,
        );
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: propertyDefinitionKeys.all(channelId),
      });
    },
  });
}

export function useReorderPropertyDefinitions(channelId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (definitionIds: string[]) =>
      propertyDefinitionsApi.reorderDefinitions(channelId, definitionIds),
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: propertyDefinitionKeys.all(channelId),
      });
    },
  });
}

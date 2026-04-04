import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as notificationPreferencesApi from "@/services/api/notification-preferences";
import type {
  NotificationPreferencesResponse,
  UpdateNotificationPreferencesRequest,
} from "@/services/api/notification-preferences";

export function useNotificationPreferences() {
  const queryClient = useQueryClient();

  const { data: preferences, isLoading } = useQuery({
    queryKey: ["notificationPreferences"],
    queryFn: () => notificationPreferencesApi.getPreferences(),
  });

  const updateMutation = useMutation({
    mutationFn: (dto: UpdateNotificationPreferencesRequest) =>
      notificationPreferencesApi.updatePreferences(dto),
    onMutate: async (newPrefs) => {
      // Cancel any outgoing refetches so they don't overwrite our optimistic update
      await queryClient.cancelQueries({
        queryKey: ["notificationPreferences"],
      });
      const previous =
        queryClient.getQueryData<NotificationPreferencesResponse>([
          "notificationPreferences",
        ]);
      queryClient.setQueryData<NotificationPreferencesResponse>(
        ["notificationPreferences"],
        (old) => {
          if (!old) return old;
          return { ...old, ...newPrefs };
        },
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      // Rollback on error
      if (context?.previous) {
        queryClient.setQueryData(["notificationPreferences"], context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["notificationPreferences"] });
    },
  });

  return {
    preferences,
    isLoading,
    updatePreferences: updateMutation.mutateAsync,
    isUpdating: updateMutation.isPending,
  };
}

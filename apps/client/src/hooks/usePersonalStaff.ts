import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import applicationsApi from "@/services/api/applications";
import type {
  CreatePersonalStaffDto,
  UpdatePersonalStaffDto,
} from "@/services/api/applications";
import { useSelectedWorkspaceId } from "@/stores";

/**
 * Hook to fetch the personal staff bot for a given installed app.
 * Returns undefined data (with enabled=false) when appId is not provided.
 */
export function usePersonalStaff(appId: string | undefined) {
  return useQuery({
    queryKey: ["personal-staff", appId],
    queryFn: () => applicationsApi.getPersonalStaff(appId!),
    enabled: !!appId,
    staleTime: 30000,
  });
}

/**
 * Hook to create the personal staff bot for an installed app.
 * Invalidates personal-staff and installed-applications-with-bots queries on success.
 */
export function useCreatePersonalStaff() {
  const queryClient = useQueryClient();
  const workspaceId = useSelectedWorkspaceId();

  return useMutation({
    mutationFn: ({
      appId,
      body,
    }: {
      appId: string;
      body: CreatePersonalStaffDto;
    }) => applicationsApi.createPersonalStaff(appId, body),
    onSuccess: (_, { appId }) => {
      queryClient.invalidateQueries({
        queryKey: ["personal-staff", appId],
      });
      queryClient.invalidateQueries({
        queryKey: ["installed-applications-with-bots", workspaceId],
      });
    },
  });
}

/**
 * Hook to update the personal staff bot for an installed app.
 * Invalidates personal-staff and installed-applications-with-bots queries on success.
 */
export function useUpdatePersonalStaff() {
  const queryClient = useQueryClient();
  const workspaceId = useSelectedWorkspaceId();

  return useMutation({
    mutationFn: ({
      appId,
      body,
    }: {
      appId: string;
      body: UpdatePersonalStaffDto;
    }) => applicationsApi.updatePersonalStaff(appId, body),
    onSuccess: (_, { appId }) => {
      queryClient.invalidateQueries({
        queryKey: ["personal-staff", appId],
      });
      queryClient.invalidateQueries({
        queryKey: ["installed-applications-with-bots", workspaceId],
      });
    },
  });
}

/**
 * Hook to delete the personal staff bot for an installed app.
 * Invalidates personal-staff and installed-applications-with-bots queries on success.
 */
export function useDeletePersonalStaff() {
  const queryClient = useQueryClient();
  const workspaceId = useSelectedWorkspaceId();

  return useMutation({
    mutationFn: (appId: string) => applicationsApi.deletePersonalStaff(appId),
    onSuccess: (_, appId) => {
      queryClient.invalidateQueries({
        queryKey: ["personal-staff", appId],
      });
      queryClient.invalidateQueries({
        queryKey: ["installed-applications-with-bots", workspaceId],
      });
    },
  });
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/services/api";
import type { InstallRecommendedStaffDto } from "@/services/api/agent-hub";
import { useSelectedWorkspaceId } from "@/stores/useWorkspaceStore";

export const agentHubRecommendedStaffQueryKey = (
  workspaceId: string | null | undefined,
) => ["agent-hub-recommended-staff", workspaceId] as const;

export function useRecommendedStaff() {
  const workspaceId = useSelectedWorkspaceId();

  return useQuery({
    queryKey: agentHubRecommendedStaffQueryKey(workspaceId),
    queryFn: () => api.agentHub.getRecommendedStaff(),
    enabled: !!workspaceId,
    staleTime: 30000,
  });
}

export function useInstallRecommendedStaff() {
  const queryClient = useQueryClient();
  const workspaceId = useSelectedWorkspaceId();

  return useMutation({
    mutationFn: ({
      templateId,
      body,
    }: {
      templateId: string;
      body?: InstallRecommendedStaffDto;
    }) => api.agentHub.installRecommendedStaff(templateId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: agentHubRecommendedStaffQueryKey(workspaceId),
      });
      queryClient.invalidateQueries({
        queryKey: ["installed-applications-with-bots", workspaceId],
      });
    },
  });
}

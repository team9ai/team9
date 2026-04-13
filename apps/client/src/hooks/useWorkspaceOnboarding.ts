import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import workspaceApi from "@/services/api/workspace";
import type {
  OnboardingRoleSelection,
  OnboardingTasksSelection,
  WorkspaceOnboardingStepData,
} from "@/types/workspace";

export function useOnboardingRoles(lang: string | undefined) {
  return useQuery({
    queryKey: ["onboarding-roles", lang],
    queryFn: () => workspaceApi.getOnboardingRoles(lang),
    staleTime: 5 * 60_000,
  });
}

export function useWorkspaceOnboarding(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["workspace-onboarding", workspaceId],
    queryFn: () => workspaceApi.getOnboardingState(workspaceId!),
    enabled: !!workspaceId,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    refetchInterval: (query) =>
      query.state.data?.status === "provisioning" ? 1500 : false,
  });
}

export function useUpdateWorkspaceOnboarding(workspaceId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      currentStep?: number;
      status?: "in_progress" | "completed";
      stepData?: WorkspaceOnboardingStepData;
    }) => workspaceApi.updateOnboardingState(workspaceId!, data),
    onSuccess: (data) => {
      queryClient.setQueryData(["workspace-onboarding", workspaceId], data);
    },
  });
}

export function useGenerateOnboardingTasks(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: (data: {
      role: OnboardingRoleSelection;
      tasks?: OnboardingTasksSelection;
      lang?: string;
    }) => workspaceApi.generateOnboardingTasks(workspaceId!, data),
  });
}

export function useGenerateOnboardingChannels(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: (data: {
      role: OnboardingRoleSelection;
      tasks?: OnboardingTasksSelection;
      lang?: string;
    }) => workspaceApi.generateOnboardingChannels(workspaceId!, data),
  });
}

export function useGenerateOnboardingAgents(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: (data: {
      role: OnboardingRoleSelection;
      tasks?: OnboardingTasksSelection;
      lang?: string;
    }) => workspaceApi.generateOnboardingAgents(workspaceId!, data),
  });
}

export function useCompleteWorkspaceOnboarding(
  workspaceId: string | undefined,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data?: { lang?: string }) =>
      workspaceApi.completeOnboarding(workspaceId!, data),
    onSuccess: (data) => {
      queryClient.setQueryData(["workspace-onboarding", workspaceId], data);
    },
  });
}

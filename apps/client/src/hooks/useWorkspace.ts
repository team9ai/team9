import {
  useQuery,
  useMutation,
  useQueryClient,
  useInfiniteQuery,
} from "@tanstack/react-query";
import workspaceApi from "@/services/api/workspace";
import type { CreateInvitationDto } from "@/types/workspace";

/**
 * Hook to fetch user's workspaces
 */
export function useUserWorkspaces() {
  return useQuery({
    queryKey: ["user-workspaces"],
    queryFn: () => workspaceApi.getUserWorkspaces(),
  });
}

/**
 * Hook to fetch workspace invitations
 */
export function useWorkspaceInvitations(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["workspace-invitations", workspaceId],
    queryFn: () => workspaceApi.getInvitations(workspaceId!),
    enabled: !!workspaceId,
  });
}

/**
 * Hook to create a workspace invitation
 */
export function useCreateInvitation(workspaceId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateInvitationDto) =>
      workspaceApi.createInvitation(workspaceId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["workspace-invitations", workspaceId],
      });
    },
  });
}

/**
 * Hook to revoke a workspace invitation
 */
export function useRevokeInvitation(workspaceId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (code: string) =>
      workspaceApi.revokeInvitation(workspaceId!, code),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["workspace-invitations", workspaceId],
      });
    },
  });
}

/**
 * Hook to get invitation info (public)
 */
export function useInvitationInfo(code: string | undefined) {
  return useQuery({
    queryKey: ["invitation-info", code],
    queryFn: () => workspaceApi.getInvitationInfo(code!),
    enabled: !!code,
  });
}

/**
 * Hook to fetch workspace members with infinite scroll pagination
 */
export function useWorkspaceMembers(
  workspaceId: string | undefined,
  options?: { search?: string; limit?: number },
) {
  const limit = options?.limit ?? 20;

  return useInfiniteQuery({
    queryKey: ["workspace-members", workspaceId, options?.search],
    queryFn: ({ pageParam = 1 }) =>
      workspaceApi.getMembers(workspaceId!, {
        page: pageParam,
        limit,
        search: options?.search,
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      const { page, totalPages } = lastPage.pagination;
      return page < totalPages ? page + 1 : undefined;
    },
    enabled: !!workspaceId,
  });
}

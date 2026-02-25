import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import imApi, {
  type Section,
  type CreateSectionDto,
  type UpdateSectionDto,
  type MoveChannelDto,
} from "@/services/api/im";
import { useSelectedWorkspaceId } from "@/stores";

/**
 * Hook to fetch all sections
 */
export function useSections() {
  const workspaceId = useSelectedWorkspaceId();

  return useQuery({
    queryKey: ["sections", workspaceId],
    queryFn: () => imApi.sections.getSections(),
    staleTime: 30000,
    enabled: !!workspaceId,
  });
}

/**
 * Hook to create a new section
 */
export function useCreateSection() {
  const queryClient = useQueryClient();
  const workspaceId = useSelectedWorkspaceId();

  return useMutation({
    mutationFn: (data: CreateSectionDto) => imApi.sections.createSection(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sections", workspaceId] });
    },
  });
}

/**
 * Hook to update a section
 */
export function useUpdateSection() {
  const queryClient = useQueryClient();
  const workspaceId = useSelectedWorkspaceId();

  return useMutation({
    mutationFn: ({
      sectionId,
      data,
    }: {
      sectionId: string;
      data: UpdateSectionDto;
    }) => imApi.sections.updateSection(sectionId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sections", workspaceId] });
    },
  });
}

/**
 * Hook to delete a section
 */
export function useDeleteSection() {
  const queryClient = useQueryClient();
  const workspaceId = useSelectedWorkspaceId();

  return useMutation({
    mutationFn: (sectionId: string) => imApi.sections.deleteSection(sectionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sections", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["channels", workspaceId] });
      queryClient.invalidateQueries({
        queryKey: ["publicChannels", workspaceId],
      });
    },
  });
}

/**
 * Hook to reorder sections
 */
export function useReorderSections() {
  const queryClient = useQueryClient();
  const workspaceId = useSelectedWorkspaceId();

  return useMutation({
    mutationFn: (sectionIds: string[]) =>
      imApi.sections.reorderSections(sectionIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sections", workspaceId] });
    },
  });
}

/**
 * Hook to move a channel to a section
 */
export function useMoveChannel(onError?: (error: any) => void) {
  const queryClient = useQueryClient();
  const workspaceId = useSelectedWorkspaceId();

  return useMutation({
    mutationFn: ({
      channelId,
      data,
    }: {
      channelId: string;
      data: MoveChannelDto;
    }) => imApi.sections.moveChannel(channelId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sections", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["channels", workspaceId] });
      queryClient.invalidateQueries({
        queryKey: ["publicChannels", workspaceId],
      });
    },
    onError,
  });
}

export type { Section };

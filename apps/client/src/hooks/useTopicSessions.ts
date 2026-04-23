import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import imApi, {
  type CreateTopicSessionDto,
  type TopicSessionGroup,
  type TopicSessionResponse,
} from "@/services/api/im";
import { useSelectedWorkspaceId } from "@/stores";

/**
 * Sidebar data: topic sessions grouped by agent (recent N per agent,
 * plus a pointer to any legacy direct channel with the same agent).
 *
 * Query key carries `perAgent` so different callers can request different
 * limits without clobbering each other's cached data — the sidebar uses
 * 5, a potential "detail drawer" could use 20.
 */
export function useTopicSessionsGrouped(perAgent = 5) {
  const workspaceId = useSelectedWorkspaceId();

  return useQuery<TopicSessionGroup[]>({
    queryKey: ["topic-sessions-grouped", workspaceId, perAgent],
    queryFn: () => imApi.topicSessions.getGrouped(perAgent),
    staleTime: 30_000,
    enabled: !!workspaceId,
  });
}

/**
 * Create a new topic session. On success, the grouped + channels
 * caches are invalidated so the sidebar picks up the new session.
 *
 * The server has already persisted the first message by the time this
 * returns — the caller should navigate straight to the new channelId
 * without any `autoSend` / `draft` URL dance.
 */
export function useCreateTopicSession() {
  const queryClient = useQueryClient();
  const workspaceId = useSelectedWorkspaceId();

  return useMutation<TopicSessionResponse, Error, CreateTopicSessionDto>({
    mutationFn: (data) => imApi.topicSessions.create(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["channels", workspaceId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["topic-sessions-grouped", workspaceId],
      });
    },
  });
}

/**
 * Archive a topic session. Only the creator succeeds; others get 403.
 */
export function useDeleteTopicSession() {
  const queryClient = useQueryClient();
  const workspaceId = useSelectedWorkspaceId();

  return useMutation<void, Error, { channelId: string }>({
    mutationFn: ({ channelId }) => imApi.topicSessions.delete(channelId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["channels", workspaceId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["topic-sessions-grouped", workspaceId],
      });
    },
  });
}

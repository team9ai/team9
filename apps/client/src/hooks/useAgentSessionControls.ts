import { useMutation, useQueryClient } from "@tanstack/react-query";
import imApi from "@/services/api/im";
import { channelAgentSessionKey } from "./useChannelAgentSession";

export function useAgentSessionControls(channelId: string | null | undefined) {
  const queryClient = useQueryClient();

  const refreshSession = () => {
    if (!channelId) return;
    void queryClient.invalidateQueries({
      queryKey: channelAgentSessionKey(channelId),
    });
  };

  const pauseMutation = useMutation({
    mutationFn: () => imApi.channels.pauseAgentSession(channelId as string),
    onSuccess: refreshSession,
  });

  const resumeMutation = useMutation({
    mutationFn: () => imApi.channels.resumeAgentSession(channelId as string),
    onSuccess: refreshSession,
  });

  return {
    pause: pauseMutation.mutate,
    pauseAsync: pauseMutation.mutateAsync,
    resume: resumeMutation.mutate,
    resumeAsync: resumeMutation.mutateAsync,
    isPausing: pauseMutation.isPending,
    isResuming: resumeMutation.isPending,
    pauseError: pauseMutation.error,
    resumeError: resumeMutation.error,
  };
}

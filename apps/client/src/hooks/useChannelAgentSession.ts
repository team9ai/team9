import { useQuery } from "@tanstack/react-query";
import imApi from "@/services/api/im";

export function channelAgentSessionKey(channelId: string | null | undefined) {
  return ["channel-agent-session", channelId] as const;
}

export function useChannelAgentSession(
  channelId: string | null | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: channelAgentSessionKey(channelId),
    queryFn: () => imApi.channels.getAgentSession(channelId as string),
    enabled: enabled && !!channelId,
    staleTime: 15_000,
    retry: false,
  });
}

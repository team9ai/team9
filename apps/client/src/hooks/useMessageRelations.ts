import { useQuery } from "@tanstack/react-query";
import { messageRelationsApi } from "@/services/api/properties";
import { relationKeys } from "@/lib/query-client";

export function useMessageRelations(messageId: string | undefined, depth = 1) {
  return useQuery({
    queryKey: messageId
      ? [...relationKeys.byMessage(messageId), depth]
      : (["relations", "disabled"] as const),
    queryFn: () =>
      messageRelationsApi.getMessageRelations(messageId!, { depth }),
    enabled: !!messageId,
    staleTime: 30_000,
  });
}

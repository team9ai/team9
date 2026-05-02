import http from "../http";
import type { Message, ForwardItem } from "@/types/im";
import { normalizeMessage } from "./normalize-reactions";

export const forwardApi = {
  // Forward messages to a target channel
  create: async (input: {
    targetChannelId: string;
    sourceChannelId: string;
    sourceMessageIds: string[];
    clientMsgId?: string;
  }): Promise<Message> => {
    const response = await http.post<Message>(
      `/v1/im/channels/${input.targetChannelId}/forward`,
      {
        sourceChannelId: input.sourceChannelId,
        sourceMessageIds: input.sourceMessageIds,
        clientMsgId: input.clientMsgId,
      },
    );
    return normalizeMessage(response.data);
  },

  // Get forward items for a forwarded message
  getItems: async (messageId: string): Promise<ForwardItem[]> => {
    const response = await http.get<ForwardItem[]>(
      `/v1/im/messages/${messageId}/forward-items`,
    );
    return response.data;
  },
};

export default forwardApi;

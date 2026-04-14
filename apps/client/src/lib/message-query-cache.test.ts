import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { upsertChannelMessageInCache } from "./message-query-cache";
import type { Message, PaginatedMessagesResponse } from "@/types/im";

function makeMessage(id: string): Message {
  return {
    id,
    channelId: "channel-1",
    senderId: "user-1",
    content: `message-${id}`,
    type: "text",
    isPinned: false,
    isEdited: false,
    isDeleted: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    reactions: [],
  };
}

describe("upsertChannelMessageInCache", () => {
  it("seeds latest and target-message caches when none exist", () => {
    const queryClient = new QueryClient();
    const message = makeMessage("msg-1");

    upsertChannelMessageInCache(queryClient, "channel-1", message);

    const latest = queryClient.getQueryData<{
      pages: PaginatedMessagesResponse[];
    }>(["messages", "channel-1", "latest"]);
    const target = queryClient.getQueryData<{
      pages: PaginatedMessagesResponse[];
    }>(["messages", "channel-1", "msg-1"]);

    expect(latest?.pages[0]?.messages[0]?.id).toBe("msg-1");
    expect(target?.pages[0]?.messages[0]?.id).toBe("msg-1");
  });

  it("prepends to existing channel caches without duplicating the same message", () => {
    const queryClient = new QueryClient();
    const existing = makeMessage("msg-existing");
    const inserted = makeMessage("msg-2");

    queryClient.setQueryData(["messages", "channel-1", "latest"], {
      pages: [
        {
          messages: [existing],
          hasOlder: false,
          hasNewer: false,
        },
      ],
      pageParams: [undefined],
    });

    upsertChannelMessageInCache(queryClient, "channel-1", inserted);
    upsertChannelMessageInCache(queryClient, "channel-1", inserted);

    const latest = queryClient.getQueryData<{
      pages: PaginatedMessagesResponse[];
    }>(["messages", "channel-1", "latest"]);

    expect(latest?.pages[0]?.messages.map((message) => message.id)).toEqual([
      "msg-2",
      "msg-existing",
    ]);
  });
});

import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import { normalizeMessage } from "@/services/api/normalize-reactions";
import type { Message, PaginatedMessagesResponse } from "@/types/im";

type MessagesPage = Message[] | PaginatedMessagesResponse;
type MessagesQueryData = InfiniteData<MessagesPage>;

function getMessages(page: MessagesPage): Message[] {
  return Array.isArray(page) ? page : page.messages;
}

function setMessages(page: MessagesPage, messages: Message[]): MessagesPage {
  return Array.isArray(page) ? messages : { ...page, messages };
}

function upsertMessage(
  old: MessagesQueryData | undefined,
  message: Message,
): MessagesQueryData {
  if (!old) {
    return {
      pages: [{ messages: [message], hasOlder: false, hasNewer: false }],
      pageParams: [undefined],
    };
  }

  let found = false;
  const pages = old.pages.map((page) => {
    const messages = getMessages(page);
    const index = messages.findIndex((item) => item.id === message.id);

    if (index === -1) {
      return page;
    }

    found = true;
    const nextMessages = [...messages];
    nextMessages[index] = message;
    return setMessages(page, nextMessages);
  });

  if (found) {
    return { ...old, pages };
  }

  return {
    ...old,
    pages: [
      setMessages(old.pages[0], [
        message,
        ...getMessages(old.pages[0]).filter((item) => item.id !== message.id),
      ]),
      ...old.pages.slice(1),
    ],
  };
}

export function upsertChannelMessageInCache(
  queryClient: QueryClient,
  channelId: string,
  message: Message,
) {
  const normalizedMessage = normalizeMessage(message);
  const seedKeys = new Set(["latest", normalizedMessage.id]);

  for (const key of seedKeys) {
    queryClient.setQueryData<MessagesQueryData>(
      ["messages", channelId, key],
      (old) => upsertMessage(old, normalizedMessage),
    );
  }

  queryClient.setQueryData<MessagesQueryData>(["messages", channelId], (old) =>
    upsertMessage(old, normalizedMessage),
  );

  queryClient.setQueriesData(
    { queryKey: ["messages", channelId] },
    (old: MessagesQueryData | undefined) =>
      upsertMessage(old, normalizedMessage),
  );
}

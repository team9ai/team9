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

export function upsertIncomingMessageInData(
  old: MessagesQueryData | undefined,
  message: Message,
  matchedTempId?: string,
): MessagesQueryData {
  const normalizedMessage = normalizeMessage(message);
  const persistedMessage: Message = {
    ...normalizedMessage,
    sendStatus: undefined,
    _retryData: undefined,
  };

  if (!old || old.pages.length === 0) {
    return {
      pages: [
        {
          messages: [persistedMessage],
          hasOlder: false,
          hasNewer: false,
        },
      ],
      pageParams: [undefined],
    };
  }

  const serverExists = old.pages.some((page) =>
    getMessages(page).some((current) => current.id === persistedMessage.id),
  );
  const tempExists = matchedTempId
    ? old.pages.some((page) =>
        getMessages(page).some((current) => current.id === matchedTempId),
      )
    : false;

  const pages = old.pages.map((page) => {
    const nextMessages: Message[] = [];

    for (const current of getMessages(page)) {
      if (matchedTempId && current.id === matchedTempId) {
        if (!serverExists) {
          nextMessages.push(persistedMessage);
        }
        continue;
      }

      if (current.id === persistedMessage.id) {
        nextMessages.push(persistedMessage);
        continue;
      }

      nextMessages.push(current);
    }

    return setMessages(page, nextMessages);
  });

  if (!serverExists && !tempExists) {
    pages[0] = setMessages(old.pages[0], [
      persistedMessage,
      ...getMessages(pages[0]),
    ]);
  }

  return { ...old, pages };
}

export function upsertChannelMessageInCache(
  queryClient: QueryClient,
  channelId: string,
  message: Message,
  matchedTempId?: string,
) {
  const normalizedMessage = normalizeMessage(message);
  const seedKeys = new Set(["latest", normalizedMessage.id]);

  for (const key of seedKeys) {
    queryClient.setQueryData<MessagesQueryData>(
      ["messages", channelId, key],
      (old) =>
        upsertIncomingMessageInData(old, normalizedMessage, matchedTempId),
    );
  }

  queryClient.setQueryData<MessagesQueryData>(["messages", channelId], (old) =>
    upsertIncomingMessageInData(old, normalizedMessage, matchedTempId),
  );

  queryClient.setQueriesData(
    { queryKey: ["messages", channelId] },
    (old: MessagesQueryData | undefined) =>
      upsertIncomingMessageInData(old, normalizedMessage, matchedTempId),
  );
}

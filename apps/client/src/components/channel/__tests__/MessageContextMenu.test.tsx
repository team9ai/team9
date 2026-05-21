import { describe, expect, it, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MouseEventHandler, ReactNode } from "react";
import type { Message } from "@/types/im";

const getFullContentMock = vi.hoisted(() => vi.fn());

vi.mock("@/services/api/im", () => ({
  default: {
    messages: {
      getFullContent: getFullContentMock,
    },
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/components/ui/context-menu", () => ({
  ContextMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ContextMenuTrigger: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  ContextMenuContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  ContextMenuItem: ({
    children,
    onClick,
  }: {
    children: ReactNode;
    onClick?: MouseEventHandler<HTMLButtonElement>;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  ContextMenuSeparator: () => <hr />,
  ContextMenuShortcut: ({ children }: { children: ReactNode }) => (
    <span>{children}</span>
  ),
}));

import { MessageContextMenu } from "../MessageContextMenu";

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg-1",
    channelId: "ch-1",
    senderId: "user-1",
    content: "preview content",
    type: "text",
    isPinned: false,
    isEdited: false,
    isDeleted: false,
    createdAt: "2026-05-21T12:00:00Z",
    updatedAt: "2026-05-21T12:00:00Z",
    ...overrides,
  };
}

function renderMenu(message: Message, queryClient = createQueryClient()) {
  const onCopyMessage = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <MessageContextMenu
        message={message}
        isOwnMessage={false}
        onCopyMessage={onCopyMessage}
      >
        <div>message row</div>
      </MessageContextMenu>
    </QueryClientProvider>,
  );
  return { onCopyMessage };
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

describe("MessageContextMenu copy message", () => {
  const writeText = vi.fn();

  beforeEach(() => {
    getFullContentMock.mockReset();
    writeText.mockReset();
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
  });

  it("copies normal message content without fetching full content", async () => {
    const { onCopyMessage } = renderMenu(makeMessage());

    fireEvent.click(screen.getByRole("button", { name: /copyMessage/ }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("preview content");
    });
    expect(getFullContentMock).not.toHaveBeenCalled();
    expect(onCopyMessage).toHaveBeenCalledTimes(1);
  });

  it("fetches and copies full content for truncated long_text messages", async () => {
    getFullContentMock.mockResolvedValue({ content: "full content" });
    const { onCopyMessage } = renderMenu(
      makeMessage({
        type: "long_text",
        isTruncated: true,
        fullContentLength: 5000,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /copyMessage/ }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("full content");
    });
    expect(getFullContentMock).toHaveBeenCalledWith("msg-1");
    expect(onCopyMessage).toHaveBeenCalledTimes(1);
  });

  it("reuses cached full content when available", async () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(["message-full-content", "msg-1"], {
      content: "cached full content",
    });
    renderMenu(
      makeMessage({
        type: "long_text",
        isTruncated: true,
        fullContentLength: 5000,
      }),
      queryClient,
    );

    fireEvent.click(screen.getByRole("button", { name: /copyMessage/ }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("cached full content");
    });
    expect(getFullContentMock).not.toHaveBeenCalled();
  });
});

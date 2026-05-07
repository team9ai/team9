import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Message } from "@/types/im";

import { MessageItem } from "../MessageItem";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>{ui}</TooltipProvider>
    </QueryClientProvider>,
  );
}

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg-1",
    channelId: "ch-1",
    senderId: "user-1",
    content: "hello",
    type: "text",
    isPinned: false,
    isEdited: false,
    isDeleted: false,
    createdAt: "2026-03-27T12:00:00Z",
    updatedAt: "2026-03-27T12:00:00Z",
    sender: {
      id: "user-1",
      email: "alice@example.com",
      username: "alice",
      displayName: "Alice",
      status: "online",
      isActive: true,
      createdAt: "2026-03-27T12:00:00Z",
      updatedAt: "2026-03-27T12:00:00Z",
    },
    ...overrides,
  };
}

describe("MessageItem send status", () => {
  it("shows the backend failure reason for failed optimistic messages", () => {
    renderWithProviders(
      <MessageItem
        message={makeMessage({
          sendStatus: "failed",
          sendError: "Channel is archived and no longer accepts new messages",
        })}
      />,
    );

    expect(
      screen.getByText(
        "message:sendFailed: Channel is archived and no longer accepts new messages",
      ),
    ).toBeInTheDocument();
  });
});

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { getSeededAvatarGradient } from "@/lib/avatar-colors";
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
    ...overrides,
  };
}

describe("MessageItem avatar fallback", () => {
  it("renders seeded initials for a sender without avatarUrl", () => {
    const message = makeMessage({
      sender: {
        id: "user-seeded",
        email: "alice@example.com",
        username: "alice",
        displayName: "Alice Smith",
        avatarUrl: undefined,
        status: "online",
        isActive: true,
        createdAt: "2026-03-27T12:00:00Z",
        updatedAt: "2026-03-27T12:00:00Z",
      },
    });

    renderWithProviders(<MessageItem message={message} />);

    const fallback = screen.getByText("AS");
    expect(fallback).toHaveClass(getSeededAvatarGradient("user-seeded"));
  });

  it("renders an agent type badge in the author row", () => {
    const message = makeMessage({
      sender: {
        id: "bot-1",
        email: "bot@example.com",
        username: "claude_bot_workspace",
        displayName: "Claude",
        avatarUrl: undefined,
        status: "online",
        isActive: true,
        userType: "bot",
        createdAt: "2026-03-27T12:00:00Z",
        updatedAt: "2026-03-27T12:00:00Z",
        agentType: "base_model",
      } as any,
    });

    renderWithProviders(<MessageItem message={message} />);

    expect(screen.getByText("Model")).toBeInTheDocument();
  });
});

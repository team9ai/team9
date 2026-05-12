import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AgentEventMetadata, Message } from "@/types/im";
import { TooltipProvider } from "@/components/ui/tooltip";
import { A2UIResponseItem } from "../A2UIResponseItem";

vi.mock("@/hooks/useAuth", () => ({
  useCurrentUser: () => ({ data: { id: "current-user" } }),
}));

function makeMessage(): Message {
  return {
    id: "response-1",
    channelId: "ch-1",
    senderId: "current-user",
    content: '这次可以选多个，随便选！: 选项 B, 选项 D, Other — "测试"',
    type: "text",
    metadata: {},
    isPinned: false,
    isEdited: false,
    isDeleted: false,
    createdAt: "2026-05-13T02:02:00.000Z",
    updatedAt: "2026-05-13T02:02:00.000Z",
    sender: {
      id: "current-user",
      email: "winrey@example.com",
      username: "winrey",
      displayName: "Winrey Ma",
      avatarUrl: "https://cdn.example.com/winrey.png",
      status: "online",
      isActive: true,
      createdAt: "2026-05-13T02:02:00.000Z",
      updatedAt: "2026-05-13T02:02:00.000Z",
    },
  };
}

describe("A2UIResponseItem", () => {
  it("renders the selected response as actor, time, and selected values", () => {
    const metadata: AgentEventMetadata = {
      agentEventType: "a2ui_response",
      status: "completed",
      surfaceId: "choices-1",
      responderId: "current-user",
      responderName: "Winrey Ma",
      responderAvatarUrl: "https://cdn.example.com/winrey.png",
    };

    render(
      <TooltipProvider>
        <A2UIResponseItem message={makeMessage()} metadata={metadata} />
      </TooltipProvider>,
    );

    expect(screen.getByText("WM")).toBeInTheDocument();
    expect(screen.queryByText("✓")).not.toBeInTheDocument();
    expect(screen.getByText("“Winrey Ma(你)”")).toBeInTheDocument();
    expect(screen.getByText("在")).toBeInTheDocument();
    expect(screen.getByText("“这次可以选多个，随便选！”")).toBeInTheDocument();
    expect(screen.getByText("选择了")).toBeInTheDocument();
    expect(
      screen.getByText('“选项 B, 选项 D, Other — "测试"”'),
    ).toBeInTheDocument();
    expect(screen.getByText(/\d{2}:02/)).toBeInTheDocument();
  });

  it("marks the selected response actor as an interactive hover target", () => {
    const metadata: AgentEventMetadata = {
      agentEventType: "a2ui_response",
      status: "completed",
      surfaceId: "choices-1",
      responderId: "current-user",
      responderName: "Winrey Ma",
      responderAvatarUrl: "https://cdn.example.com/winrey.png",
    };

    render(
      <TooltipProvider>
        <A2UIResponseItem message={makeMessage()} metadata={metadata} />
      </TooltipProvider>,
    );

    expect(screen.getByText("“Winrey Ma(你)”")).toHaveClass(
      "cursor-pointer",
      "hover:underline",
    );
  });
});

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MessageReactions } from "../MessageReactions";
import type { MessageReaction } from "@/types/im";

vi.mock("@/hooks/useChannels", () => ({
  useChannelMembers: () => ({ data: [] }),
}));

function makeReaction(
  overrides: Partial<MessageReaction> = {},
): MessageReaction {
  return {
    id: "reaction-1",
    messageId: "message-1",
    userId: "user-1",
    emoji: "👍",
    createdAt: "2026-05-22T09:00:00Z",
    ...overrides,
  };
}

describe("MessageReactions", () => {
  it("renders reactions as static chips in read-only mode", () => {
    const onAddReaction = vi.fn();
    const onRemoveReaction = vi.fn();

    render(
      <MessageReactions
        reactions={[makeReaction()]}
        currentUserId="user-1"
        readOnly
        onAddReaction={onAddReaction}
        onRemoveReaction={onRemoveReaction}
      />,
    );

    expect(screen.getByText("👍")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("👍"));
    expect(onAddReaction).not.toHaveBeenCalled();
    expect(onRemoveReaction).not.toHaveBeenCalled();
  });
});

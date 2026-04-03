import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { UserListItem } from "../UserListItem";

vi.mock("@/hooks/useIMUsers", () => ({
  useIsUserOnline: vi.fn(() => false),
}));

describe("UserListItem avatar size", () => {
  it("uses the larger default avatar size for sidebar items", () => {
    render(
      <UserListItem
        name="Claude"
        userId="bot-claude"
        subtitle="@claude_bot_workspace"
        isBot
      />,
    );

    expect(screen.getByText("C").closest("[data-slot='avatar']")).toHaveClass(
      "w-9",
      "h-9",
    );
  });
});

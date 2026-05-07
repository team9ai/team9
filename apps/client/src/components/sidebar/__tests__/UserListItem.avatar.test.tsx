import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { getSeededAvatarGradient } from "@/lib/avatar-colors";

import { UserListItem } from "../UserListItem";

vi.mock("@/hooks/useIMUsers", () => ({
  useIsUserOnline: vi.fn(() => false),
}));

describe("UserListItem avatar fallback", () => {
  it("uses userId as the seeded fallback key", () => {
    render(
      <UserListItem
        name="Alice Smith"
        avatar="A"
        userId="user-seeded"
        subtitle="@alice"
      />,
    );

    expect(screen.getByText("AS")).toHaveClass(
      getSeededAvatarGradient("user-seeded"),
    );
  });

  it("keeps the agent badge visible when the name is long", () => {
    render(
      <UserListItem
        name="123123123123123123123123123123"
        userId="openclaw-user"
        isBot
        agentType="openclaw"
      />,
    );

    expect(screen.getByText("123123123123123123123123123123")).toHaveClass(
      "flex-1",
      "min-w-0",
      "truncate",
    );
    expect(screen.getByText("OpenClaw")).toHaveClass("shrink-0");
  });

  it("clips a long start-conversation subtitle inside the sidebar row", () => {
    render(
      <UserListItem
        name="Personal Assistant"
        userId="bot_2ca59e7a_1777056260734"
        subtitle="@bot_2ca59e7a_1777056260734_very_long_workspace_id"
        isBot
      />,
    );

    expect(screen.getByRole("button")).toHaveClass("flex", "shrink");
    expect(screen.getByRole("button")).not.toHaveClass("inline-flex");
    expect(screen.getByRole("button")).not.toHaveClass("shrink-0");
    expect(
      screen.getByText("@bot_2ca59e7a_1777056260734_very_long_workspace_id"),
    ).toHaveClass("block", "w-full", "min-w-0", "max-w-[22ch]", "truncate");
  });
});

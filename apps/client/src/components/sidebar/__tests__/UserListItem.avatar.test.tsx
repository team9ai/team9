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
});

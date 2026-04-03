import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { getInitials, getSeededAvatarGradient } from "@/lib/avatar-colors";
import { UserAvatar } from "../user-avatar";

class MockImage {
  complete = true;

  naturalWidth = 1;

  src = "";

  referrerPolicy = "";

  crossOrigin: string | null = null;

  addEventListener() {}

  removeEventListener() {}
}

describe("UserAvatar", () => {
  beforeEach(() => {
    vi.stubGlobal("Image", MockImage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders a seeded fallback for a human user without an avatar URL", () => {
    render(
      <UserAvatar
        userId="user-123"
        name="Alice Doe"
        username="alice"
        fallbackClassName="ring-2"
      />,
    );

    const fallback = screen.getByText(getInitials("Alice Doe"));

    expect(fallback).toHaveClass(
      "bg-linear-to-br",
      "text-white",
      getSeededAvatarGradient("user-123"),
      "ring-2",
    );
  });

  it("renders the uploaded avatar when an avatar URL exists", () => {
    render(
      <UserAvatar
        userId="user-456"
        name="Alice Doe"
        username="alice"
        avatarUrl="https://example.com/avatar.png"
      />,
    );

    const image = screen.getByRole("img", { name: "Alice Doe" });

    expect(image).toHaveAttribute("src", "https://example.com/avatar.png");
  });

  it("uses the username when the name is whitespace only", () => {
    render(<UserAvatar username="helper" name="   " />);

    expect(screen.getByText("H")).toBeInTheDocument();
    expect(
      screen.getByText("H").closest("[data-slot='avatar-fallback']"),
    ).toHaveClass(getSeededAvatarGradient("helper"));
  });

  it("renders the bot image and does not show fallback initials when isBot is true", () => {
    render(<UserAvatar userId="bot-1" username="helper-bot" isBot />);

    const image = screen.getByRole("img", { name: "helper-bot" });

    expect(image).toHaveAttribute("src", "/bot.webp");
    expect(screen.queryByText("H")).not.toBeInTheDocument();
  });

  it("renders the Gemini product logo for a base-model bot identity", () => {
    render(
      <UserAvatar
        userId="bot-gemini"
        name="Gemini"
        username="gemini_bot_workspace"
        isBot
      />,
    );

    const image = screen.getByRole("img", { name: "Gemini" });

    expect(image.getAttribute("src")).toContain(
      "/src/assets/base-model/gemini.webp",
    );
    expect(screen.queryByText("G")).not.toBeInTheDocument();
  });
});

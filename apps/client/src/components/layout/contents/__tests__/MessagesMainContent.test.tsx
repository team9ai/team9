import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MessagesMainContent } from "../MessagesMainContent";

describe("MessagesMainContent", () => {
  it("stretches to the full parent height so the empty state stays vertically centered", () => {
    const { container } = render(<MessagesMainContent />);

    expect(
      screen.getByRole("heading", { name: "Select a conversation" }),
    ).toBeInTheDocument();
    expect(container.firstChild).toHaveClass("h-full");
  });
});

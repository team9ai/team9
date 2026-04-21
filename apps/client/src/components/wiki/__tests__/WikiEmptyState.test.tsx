import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WikiEmptyState } from "../WikiEmptyState";

describe("WikiEmptyState", () => {
  it("renders a heading and the helper copy", () => {
    render(<WikiEmptyState />);

    expect(
      screen.getByRole("heading", { name: "Select a Wiki page" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Pick a page from the tree on the left, or create a new Wiki/i,
      ),
    ).toBeInTheDocument();
  });

  it("fills the parent so the empty state stays vertically centered", () => {
    const { container } = render(<WikiEmptyState />);
    expect(container.firstChild).toHaveClass("h-full");
  });
});

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WikiProposalBanner } from "../WikiProposalBanner";

describe("WikiProposalBanner", () => {
  it("renders the informative copy and the view button", () => {
    render(<WikiProposalBanner proposalId="prop-1" onView={vi.fn()} />);
    const banner = screen.getByTestId("wiki-proposal-banner");
    expect(banner).toHaveTextContent(/pending proposal/i);
    expect(screen.getByTestId("wiki-proposal-banner-view")).toHaveTextContent(
      /view proposal/i,
    );
  });

  it("invokes onView with the proposal id when the button is clicked", () => {
    const onView = vi.fn();
    render(<WikiProposalBanner proposalId="prop-42" onView={onView} />);
    fireEvent.click(screen.getByTestId("wiki-proposal-banner-view"));
    expect(onView).toHaveBeenCalledWith("prop-42");
  });

  it("uses role=status so assistive tech announces it", () => {
    render(<WikiProposalBanner proposalId="prop-1" onView={vi.fn()} />);
    expect(screen.getByTestId("wiki-proposal-banner")).toHaveAttribute(
      "role",
      "status",
    );
  });
});

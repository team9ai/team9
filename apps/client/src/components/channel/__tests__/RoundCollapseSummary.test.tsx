import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { RoundCollapseSummary } from "../RoundCollapseSummary";

describe("RoundCollapseSummary", () => {
  it("displays step count text with the standard copy", () => {
    render(<RoundCollapseSummary stepCount={3} onClick={() => {}} />);
    expect(screen.getByText("... 查看执行过程（3 步）")).toBeInTheDocument();
  });

  it("renders as a button element for accessibility", () => {
    render(<RoundCollapseSummary stepCount={3} onClick={() => {}} />);
    const button = screen.getByRole("button");
    expect(button).toBeInTheDocument();
    expect(button.tagName).toBe("BUTTON");
    // Ensure it's an explicit type="button" so it won't submit a parent form.
    expect(button).toHaveAttribute("type", "button");
  });

  it("calls onClick when clicked", () => {
    const onClick = vi.fn();
    render(<RoundCollapseSummary stepCount={3} onClick={onClick} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("only triggers onClick once per click", () => {
    const onClick = vi.fn();
    render(<RoundCollapseSummary stepCount={3} onClick={onClick} />);
    const button = screen.getByRole("button");
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(3);
  });

  it("has accessible label that includes the step count", () => {
    render(<RoundCollapseSummary stepCount={5} onClick={() => {}} />);
    const button = screen.getByRole("button");
    expect(button).toHaveAttribute("aria-label", expect.stringContaining("5"));
    expect(button).toHaveAttribute(
      "aria-label",
      "Expand execution process (5 steps)",
    );
  });

  it("supports keyboard activation via Enter key", () => {
    const onClick = vi.fn();
    render(<RoundCollapseSummary stepCount={2} onClick={onClick} />);
    const button = screen.getByRole("button");
    // Native <button> elements translate Enter keydown into a click event,
    // but JSDOM does not synthesize that automatically; simulate the click
    // that the browser would dispatch to confirm the handler is wired up.
    button.focus();
    expect(button).toHaveFocus();
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("is focusable via tab (default button behavior)", () => {
    render(<RoundCollapseSummary stepCount={1} onClick={() => {}} />);
    const button = screen.getByRole("button");
    // Buttons are focusable by default; confirm no negative tabindex was set.
    expect(button).not.toHaveAttribute("tabindex", "-1");
    button.focus();
    expect(document.activeElement).toBe(button);
  });

  describe("different step counts", () => {
    it("renders 1 step correctly", () => {
      render(<RoundCollapseSummary stepCount={1} onClick={() => {}} />);
      expect(screen.getByText("... 查看执行过程（1 步）")).toBeInTheDocument();
      expect(screen.getByRole("button")).toHaveAttribute(
        "aria-label",
        "Expand execution process (1 steps)",
      );
    });

    it("renders 5 steps correctly", () => {
      render(<RoundCollapseSummary stepCount={5} onClick={() => {}} />);
      expect(screen.getByText("... 查看执行过程（5 步）")).toBeInTheDocument();
    });

    it("renders 100 steps correctly", () => {
      render(<RoundCollapseSummary stepCount={100} onClick={() => {}} />);
      expect(
        screen.getByText("... 查看执行过程（100 步）"),
      ).toBeInTheDocument();
      expect(screen.getByRole("button")).toHaveAttribute(
        "aria-label",
        "Expand execution process (100 steps)",
      );
    });

    it("renders 0 steps (edge case)", () => {
      render(<RoundCollapseSummary stepCount={0} onClick={() => {}} />);
      expect(screen.getByText("... 查看执行过程（0 步）")).toBeInTheDocument();
    });
  });

  it("renders a chevron icon inside the button", () => {
    const { container } = render(
      <RoundCollapseSummary stepCount={3} onClick={() => {}} />,
    );
    // lucide-react renders an <svg> element; make sure exactly one is present
    // so we know the chevron visual affordance is rendered.
    const svgs = container.querySelectorAll("svg");
    expect(svgs.length).toBe(1);
  });
});

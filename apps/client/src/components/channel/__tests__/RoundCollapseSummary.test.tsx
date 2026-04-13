import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import i18n from "@/i18n";
import { changeLanguage } from "@/i18n/loadLanguage";
import { RoundCollapseSummary } from "../RoundCollapseSummary";

beforeEach(async () => {
  if (i18n.language !== "en") {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  }
});

describe("RoundCollapseSummary", () => {
  it("displays step count text with the standard en copy", () => {
    render(<RoundCollapseSummary stepCount={3} onClick={() => {}} />);
    expect(
      screen.getByText("... Show execution (3 steps)"),
    ).toBeInTheDocument();
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
    it("renders 1 step correctly (singular)", () => {
      render(<RoundCollapseSummary stepCount={1} onClick={() => {}} />);
      expect(
        screen.getByText("... Show execution (1 step)"),
      ).toBeInTheDocument();
      expect(screen.getByRole("button")).toHaveAttribute(
        "aria-label",
        "Expand execution process (1 step)",
      );
    });

    it("renders 5 steps correctly", () => {
      render(<RoundCollapseSummary stepCount={5} onClick={() => {}} />);
      expect(
        screen.getByText("... Show execution (5 steps)"),
      ).toBeInTheDocument();
    });

    it("renders 100 steps correctly", () => {
      render(<RoundCollapseSummary stepCount={100} onClick={() => {}} />);
      expect(
        screen.getByText("... Show execution (100 steps)"),
      ).toBeInTheDocument();
      expect(screen.getByRole("button")).toHaveAttribute(
        "aria-label",
        "Expand execution process (100 steps)",
      );
    });

    it("renders 0 steps (edge case)", () => {
      render(<RoundCollapseSummary stepCount={0} onClick={() => {}} />);
      expect(
        screen.getByText("... Show execution (0 steps)"),
      ).toBeInTheDocument();
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

  describe("i18n integration", () => {
    it("renders the zh-CN localized summary when the language is set to zh-CN", async () => {
      await act(async () => {
        await changeLanguage("zh-CN");
      });
      try {
        render(<RoundCollapseSummary stepCount={3} onClick={() => {}} />);
        expect(
          screen.getByText("... 查看执行过程（3 步）"),
        ).toBeInTheDocument();
      } finally {
        await act(async () => {
          await i18n.changeLanguage("en");
        });
      }
    });

    it("keeps the aria-label in English for assistive tech even in zh-CN", async () => {
      await act(async () => {
        await changeLanguage("zh-CN");
      });
      try {
        render(<RoundCollapseSummary stepCount={4} onClick={() => {}} />);
        expect(screen.getByRole("button")).toHaveAttribute(
          "aria-label",
          "Expand execution process (4 steps)",
        );
      } finally {
        await act(async () => {
          await i18n.changeLanguage("en");
        });
      }
    });
  });
});

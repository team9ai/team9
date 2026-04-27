import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SubmitForReviewDialog } from "../SubmitForReviewDialog";

function setup(
  overrides: Partial<React.ComponentProps<typeof SubmitForReviewDialog>> = {},
) {
  const onOpenChange = vi.fn();
  const onSubmit = vi.fn();
  const props = {
    open: true,
    onOpenChange,
    onSubmit,
    ...overrides,
  };
  const utils = render(<SubmitForReviewDialog {...props} />);
  return { ...utils, onOpenChange, onSubmit };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("SubmitForReviewDialog", () => {
  it("renders nothing when closed", () => {
    setup({ open: false });
    expect(screen.queryByTestId("submit-for-review-dialog")).toBeNull();
  });

  it("renders the title and description inputs when open", () => {
    setup();
    expect(screen.getByTestId("submit-for-review-dialog")).toBeInTheDocument();
    expect(
      screen.getByTestId("submit-for-review-title-input"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("submit-for-review-description-input"),
    ).toBeInTheDocument();
  });

  it("disables the submit button when the title is empty", () => {
    setup();
    expect(screen.getByTestId("submit-for-review-submit")).toBeDisabled();
  });

  it("disables the submit button when the title is whitespace only", () => {
    setup();
    fireEvent.change(screen.getByTestId("submit-for-review-title-input"), {
      target: { value: "   " },
    });
    expect(screen.getByTestId("submit-for-review-submit")).toBeDisabled();
  });

  it("enables the submit button once the title has content", () => {
    setup();
    fireEvent.change(screen.getByTestId("submit-for-review-title-input"), {
      target: { value: "Fix typo" },
    });
    expect(screen.getByTestId("submit-for-review-submit")).toBeEnabled();
  });

  it("calls onSubmit with the trimmed title when submit is clicked", () => {
    const { onSubmit } = setup();
    fireEvent.change(screen.getByTestId("submit-for-review-title-input"), {
      target: { value: "  Fix typo  " },
    });
    fireEvent.click(screen.getByTestId("submit-for-review-submit"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({
      title: "Fix typo",
      description: undefined,
    });
  });

  it("includes the trimmed description when provided", () => {
    const { onSubmit } = setup();
    fireEvent.change(screen.getByTestId("submit-for-review-title-input"), {
      target: { value: "Fix typo" },
    });
    fireEvent.change(
      screen.getByTestId("submit-for-review-description-input"),
      { target: { value: "  misspelled word in intro  " } },
    );
    fireEvent.click(screen.getByTestId("submit-for-review-submit"));
    expect(onSubmit).toHaveBeenCalledWith({
      title: "Fix typo",
      description: "misspelled word in intro",
    });
  });

  it("omits description when it is whitespace only", () => {
    const { onSubmit } = setup();
    fireEvent.change(screen.getByTestId("submit-for-review-title-input"), {
      target: { value: "Fix typo" },
    });
    fireEvent.change(
      screen.getByTestId("submit-for-review-description-input"),
      { target: { value: "   " } },
    );
    fireEvent.click(screen.getByTestId("submit-for-review-submit"));
    expect(onSubmit).toHaveBeenCalledWith({
      title: "Fix typo",
      description: undefined,
    });
  });

  it("submits via form submit (Enter in title input)", () => {
    const { onSubmit } = setup();
    fireEvent.change(screen.getByTestId("submit-for-review-title-input"), {
      target: { value: "Fix typo" },
    });
    const form = screen
      .getByTestId("submit-for-review-title-input")
      .closest("form")!;
    fireEvent.submit(form);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("blocks form submission when the title is empty", () => {
    const { onSubmit } = setup();
    const form = screen
      .getByTestId("submit-for-review-title-input")
      .closest("form")!;
    fireEvent.submit(form);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("Cancel calls onOpenChange(false)", () => {
    const { onOpenChange } = setup();
    fireEvent.click(screen.getByTestId("submit-for-review-cancel"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows 'Submitting…' and disables inputs while submitting", () => {
    setup({ isSubmitting: true });
    expect(screen.getByTestId("submit-for-review-submit")).toBeDisabled();
    expect(screen.getByTestId("submit-for-review-submit")).toHaveTextContent(
      "Submitting…",
    );
    expect(screen.getByTestId("submit-for-review-cancel")).toBeDisabled();
    expect(screen.getByTestId("submit-for-review-title-input")).toBeDisabled();
    expect(
      screen.getByTestId("submit-for-review-description-input"),
    ).toBeDisabled();
  });

  it("does not call onSubmit when submit is invoked mid-flight", () => {
    const { onSubmit } = setup({ isSubmitting: true });
    fireEvent.change(screen.getByTestId("submit-for-review-title-input"), {
      target: { value: "Fix typo" },
    });
    fireEvent.click(screen.getByTestId("submit-for-review-submit"));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("resets its fields each time it re-opens", () => {
    const { rerender } = render(
      <SubmitForReviewDialog open onOpenChange={vi.fn()} onSubmit={vi.fn()} />,
    );
    const titleInput = screen.getByTestId(
      "submit-for-review-title-input",
    ) as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "stale title" } });
    expect(titleInput.value).toBe("stale title");

    // Close then re-open.
    rerender(
      <SubmitForReviewDialog
        open={false}
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    act(() => {
      rerender(
        <SubmitForReviewDialog
          open
          onOpenChange={vi.fn()}
          onSubmit={vi.fn()}
        />,
      );
    });
    const fresh = screen.getByTestId(
      "submit-for-review-title-input",
    ) as HTMLInputElement;
    expect(fresh.value).toBe("");
  });
});

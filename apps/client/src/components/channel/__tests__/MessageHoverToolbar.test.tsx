import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MessageHoverToolbar } from "../MessageHoverToolbar";

// Stub EmojiPicker to avoid pulling in heavy dependencies
vi.mock("../editor/EmojiPicker", () => ({
  EmojiPicker: ({ onSelect }: { onSelect: (e: string) => void }) => (
    <button onClick={() => onSelect("👍")}>EmojiPicker</button>
  ),
}));

function renderToolbar(
  props: Partial<Parameters<typeof MessageHoverToolbar>[0]> = {},
) {
  return render(
    <TooltipProvider>
      <MessageHoverToolbar onReaction={vi.fn()} {...props} />
    </TooltipProvider>,
  );
}

// ---------------------------------------------------------------------------
// Forward + Select visibility
// ---------------------------------------------------------------------------

describe("MessageHoverToolbar — forward + select wiring", () => {
  it("renders Forward and Select buttons when forwardable=true and handlers provided", () => {
    renderToolbar({
      forwardable: true,
      onForward: vi.fn(),
      onSelect: vi.fn(),
    });

    expect(screen.getByRole("button", { name: "Forward" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select" })).toBeInTheDocument();
  });

  it("hides Forward and Select buttons when forwardable=false", () => {
    renderToolbar({
      forwardable: false,
      onForward: vi.fn(),
      onSelect: vi.fn(),
    });

    expect(
      screen.queryByRole("button", { name: "Forward" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Select" }),
    ).not.toBeInTheDocument();
  });

  it("hides Forward button when handler is not provided even with forwardable=true", () => {
    renderToolbar({
      forwardable: true,
      onForward: undefined,
      onSelect: vi.fn(),
    });

    expect(
      screen.queryByRole("button", { name: "Forward" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select" })).toBeInTheDocument();
  });

  it("hides Select button when handler is not provided even with forwardable=true", () => {
    renderToolbar({
      forwardable: true,
      onForward: vi.fn(),
      onSelect: undefined,
    });

    expect(screen.getByRole("button", { name: "Forward" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Select" }),
    ).not.toBeInTheDocument();
  });

  it("hides both buttons when forwardable is undefined (default)", () => {
    renderToolbar({
      onForward: vi.fn(),
      onSelect: vi.fn(),
    });

    expect(
      screen.queryByRole("button", { name: "Forward" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Select" }),
    ).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Click handlers
  // ---------------------------------------------------------------------------

  it("calls onForward when Forward button is clicked", () => {
    const onForward = vi.fn();
    renderToolbar({ forwardable: true, onForward, onSelect: vi.fn() });

    fireEvent.click(screen.getByRole("button", { name: "Forward" }));

    expect(onForward).toHaveBeenCalledTimes(1);
  });

  it("calls onSelect when Select button is clicked", () => {
    const onSelect = vi.fn();
    renderToolbar({ forwardable: true, onForward: vi.fn(), onSelect });

    fireEvent.click(screen.getByRole("button", { name: "Select" }));

    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // Existing toolbar buttons are not broken
  // ---------------------------------------------------------------------------

  it("still renders quick emoji buttons", () => {
    renderToolbar();

    // QUICK_EMOJIS = ["👀", "👍", "🙌", "✅"]
    expect(screen.getByRole("button", { name: "👀" })).toBeInTheDocument();
  });
});

import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Mock the heavyweight emoji-mart picker to a simple button so we can test
// selection wiring without pulling the real picker (and its font data) into
// jsdom.
vi.mock("@/components/channel/editor/EmojiPicker", () => ({
  EmojiPicker: ({ onSelect }: { onSelect: (emoji: string) => void }) => (
    <button
      type="button"
      data-testid="mock-emoji-picker"
      onClick={() => onSelect("🎨")}
    >
      pick-emoji
    </button>
  ),
}));

import { IconPickerPopover } from "../IconPickerPopover";

describe("IconPickerPopover", () => {
  it("renders the default 📄 placeholder when no value is set", () => {
    render(<IconPickerPopover onChange={() => {}} />);
    const trigger = screen.getByTestId("wiki-icon-picker-trigger");
    expect(trigger).toHaveTextContent("📄");
    expect(trigger).not.toBeDisabled();
  });

  it("renders the current emoji when value is a non-empty string", () => {
    render(<IconPickerPopover value="🚀" onChange={() => {}} />);
    expect(screen.getByTestId("wiki-icon-picker-trigger")).toHaveTextContent(
      "🚀",
    );
  });

  it("falls back to the default when value is an empty string", () => {
    render(<IconPickerPopover value="" onChange={() => {}} />);
    expect(screen.getByTestId("wiki-icon-picker-trigger")).toHaveTextContent(
      "📄",
    );
  });

  it("opens the popover and fires onChange when an emoji is selected", async () => {
    const onChange = vi.fn();
    render(<IconPickerPopover value="📄" onChange={onChange} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("wiki-icon-picker-trigger"));
    });
    // Popover content renders through a Radix portal → query from `document`.
    const picker = await screen.findByTestId("mock-emoji-picker");
    await act(async () => {
      fireEvent.click(picker);
    });

    expect(onChange).toHaveBeenCalledWith("🎨");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("closes the popover after selection", async () => {
    render(<IconPickerPopover onChange={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("wiki-icon-picker-trigger"));
    });
    const picker = await screen.findByTestId("mock-emoji-picker");
    await act(async () => {
      fireEvent.click(picker);
    });

    // Radix unmounts the content on close.
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByTestId("mock-emoji-picker")).toBeNull();
  });

  it("disables the trigger and suppresses open toggling when disabled", async () => {
    const onChange = vi.fn();
    render(<IconPickerPopover value="🚀" onChange={onChange} disabled />);

    const trigger = screen.getByTestId("wiki-icon-picker-trigger");
    expect(trigger).toBeDisabled();
    await act(async () => {
      fireEvent.click(trigger);
    });
    expect(screen.queryByTestId("mock-emoji-picker")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
});

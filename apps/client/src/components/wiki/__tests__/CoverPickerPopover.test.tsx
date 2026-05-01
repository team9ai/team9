import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CoverPickerPopover } from "../CoverPickerPopover";

async function click(el: HTMLElement) {
  await act(async () => {
    fireEvent.click(el);
  });
}

describe("CoverPickerPopover", () => {
  it("shows 'Add cover' label when no value is set", () => {
    render(<CoverPickerPopover wikiId="w-1" onChange={() => {}} />);
    const trigger = screen.getByTestId("wiki-cover-picker-trigger");
    expect(trigger).toHaveTextContent("Add cover");
    expect(trigger).toHaveAttribute("aria-label", "Add page cover");
    expect(trigger).not.toBeDisabled();
  });

  it("shows 'Change cover' label when a value exists", () => {
    render(
      <CoverPickerPopover
        wikiId="w-1"
        value="attachments/cover.jpg"
        onChange={() => {}}
      />,
    );
    const trigger = screen.getByTestId("wiki-cover-picker-trigger");
    expect(trigger).toHaveTextContent("Change cover");
    expect(trigger).toHaveAttribute("aria-label", "Change page cover");
  });

  it("opens the popover with the current value pre-filled", async () => {
    render(
      <CoverPickerPopover
        wikiId="w-1"
        value="attachments/existing.jpg"
        onChange={() => {}}
      />,
    );
    await click(screen.getByTestId("wiki-cover-picker-trigger"));
    const input = await screen.findByTestId("wiki-cover-path-input");
    expect(input).toHaveValue("attachments/existing.jpg");
  });

  it("seeds the input with an empty string when no value", async () => {
    render(<CoverPickerPopover wikiId="w-1" onChange={() => {}} />);
    await click(screen.getByTestId("wiki-cover-picker-trigger"));
    const input = await screen.findByTestId("wiki-cover-path-input");
    expect(input).toHaveValue("");
  });

  it("applies the trimmed path on Apply", async () => {
    const onChange = vi.fn();
    render(<CoverPickerPopover wikiId="w-1" onChange={onChange} />);

    await click(screen.getByTestId("wiki-cover-picker-trigger"));
    const input = (await screen.findByTestId(
      "wiki-cover-path-input",
    )) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, {
        target: { value: "  attachments/cover.jpg  " },
      });
    });
    await click(screen.getByTestId("wiki-cover-apply"));

    expect(onChange).toHaveBeenCalledWith("attachments/cover.jpg");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("hides the Remove button when no cover is set", async () => {
    render(<CoverPickerPopover wikiId="w-1" onChange={() => {}} />);
    await click(screen.getByTestId("wiki-cover-picker-trigger"));
    // The popover is open, but the remove button should be absent.
    expect(screen.queryByTestId("wiki-cover-remove")).toBeNull();
  });

  it("clears the cover when Remove is clicked", async () => {
    const onChange = vi.fn();
    render(
      <CoverPickerPopover
        wikiId="w-1"
        value="attachments/existing.jpg"
        onChange={onChange}
      />,
    );
    await click(screen.getByTestId("wiki-cover-picker-trigger"));
    await click(await screen.findByTestId("wiki-cover-remove"));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("re-seeds the input with the latest value on re-open", async () => {
    const { rerender } = render(
      <CoverPickerPopover
        wikiId="w-1"
        value="attachments/a.jpg"
        onChange={() => {}}
      />,
    );
    await click(screen.getByTestId("wiki-cover-picker-trigger"));
    expect(await screen.findByTestId("wiki-cover-path-input")).toHaveValue(
      "attachments/a.jpg",
    );

    // Close the popover by clicking Apply (simpler than keyboard Escape in jsdom).
    await click(screen.getByTestId("wiki-cover-apply"));

    // Parent updates the value while the popover is closed.
    rerender(
      <CoverPickerPopover
        wikiId="w-1"
        value="attachments/b.jpg"
        onChange={() => {}}
      />,
    );
    await click(screen.getByTestId("wiki-cover-picker-trigger"));
    expect(await screen.findByTestId("wiki-cover-path-input")).toHaveValue(
      "attachments/b.jpg",
    );
  });

  it("disables the trigger and suppresses popover opening when disabled", async () => {
    const onChange = vi.fn();
    render(
      <CoverPickerPopover
        wikiId="w-1"
        value="attachments/cover.jpg"
        onChange={onChange}
        disabled
      />,
    );
    const trigger = screen.getByTestId("wiki-cover-picker-trigger");
    expect(trigger).toBeDisabled();
    await click(trigger);
    expect(screen.queryByTestId("wiki-cover-path-input")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("uploads a local image and applies the returned cover path", async () => {
    const onChange = vi.fn();
    const onUpload = vi.fn().mockResolvedValue("covers/uploaded.png");
    render(
      <CoverPickerPopover
        wikiId="w-1"
        onChange={onChange}
        onUpload={onUpload}
      />,
    );

    await click(screen.getByTestId("wiki-cover-picker-trigger"));
    const input = await screen.findByTestId("wiki-cover-upload-input");
    const file = new File(["image"], "cover.png", { type: "image/png" });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });

    expect(onUpload).toHaveBeenCalledWith(file);
    expect(onChange).toHaveBeenCalledWith("covers/uploaded.png");
  });

  it("rejects non-image local cover files before upload", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const onUpload = vi.fn();
    render(
      <CoverPickerPopover
        wikiId="w-1"
        onChange={() => {}}
        onUpload={onUpload}
      />,
    );

    await click(screen.getByTestId("wiki-cover-picker-trigger"));
    const input = await screen.findByTestId("wiki-cover-upload-input");
    const file = new File(["text"], "cover.txt", { type: "text/plain" });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });

    expect(onUpload).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalled();
  });
});

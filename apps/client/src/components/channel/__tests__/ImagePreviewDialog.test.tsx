import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ImagePreviewDialog } from "../ImagePreviewDialog";

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

describe("ImagePreviewDialog", () => {
  it("copies the preview image to the clipboard", async () => {
    const imageBlob = new Blob(["image"], { type: "image/png" });
    const clipboardWrite = vi.fn().mockResolvedValue(undefined);
    const clipboardItem = vi.fn(function (items: Record<string, Blob>) {
      return items;
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        blob: () => Promise.resolve(imageBlob),
        ok: true,
      }),
    );
    vi.stubGlobal("ClipboardItem", clipboardItem);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { write: clipboardWrite },
    });

    render(
      <ImagePreviewDialog
        src="https://example.com/image.png"
        alt="Screenshot"
        open
        onOpenChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /copy/i }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith("https://example.com/image.png");
      expect(clipboardItem).toHaveBeenCalledWith({ "image/png": imageBlob });
      expect(clipboardWrite).toHaveBeenCalledWith([{ "image/png": imageBlob }]);
    });
  });
});

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AttachmentPreview } from "../AttachmentPreview";
import type { UploadingFile } from "@/hooks/useFileUpload";

if (typeof URL.createObjectURL !== "function") {
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: () => "blob:mock",
  });
}

function makeFile(
  overrides: Partial<UploadingFile> & { name?: string; type?: string } = {},
): UploadingFile {
  const { name = "image.png", type = "image/png", ...rest } = overrides;
  return {
    id: "file-1",
    file: new File(["content"], name, { type }),
    progress: 100,
    status: "completed",
    ...rest,
  } as UploadingFile;
}

describe("AttachmentPreview", () => {
  it("returns null when no files", () => {
    const { container } = render(
      <AttachmentPreview files={[]} onRemove={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("applies horizontal padding so attachments don't touch the edge", () => {
    const { container } = render(
      <AttachmentPreview files={[makeFile()]} onRemove={vi.fn()} />,
    );
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toMatch(/\bpx-\d+\b/);
  });

  it("uses a visible border for completed image attachments", () => {
    render(<AttachmentPreview files={[makeFile()]} onRemove={vi.fn()} />);
    const img = screen.getByAltText("image.png");
    const thumb = img.parentElement as HTMLElement;
    expect(thumb.className).not.toMatch(/border-transparent/);
    expect(thumb.className).toMatch(/border-/);
  });

  it("keeps the uploading state border for in-progress images", () => {
    render(
      <AttachmentPreview
        files={[makeFile({ status: "uploading", progress: 40 })]}
        onRemove={vi.fn()}
      />,
    );
    const img = screen.getByAltText("image.png");
    const thumb = img.parentElement as HTMLElement;
    expect(thumb.className).toMatch(/border-info\/30/);
  });

  it("keeps the error state border for failed images", () => {
    render(
      <AttachmentPreview
        files={[makeFile({ status: "error", error: "boom" })]}
        onRemove={vi.fn()}
      />,
    );
    const img = screen.getByAltText("image.png");
    const thumb = img.parentElement as HTMLElement;
    expect(thumb.className).toMatch(/border-destructive\/30/);
  });

  it("renders file attachments via the file branch (non-image)", () => {
    render(
      <AttachmentPreview
        files={[makeFile({ name: "doc.pdf", type: "application/pdf" })]}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText("doc.pdf")).toBeInTheDocument();
  });
});

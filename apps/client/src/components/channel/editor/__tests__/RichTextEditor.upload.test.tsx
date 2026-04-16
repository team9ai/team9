import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { RichTextEditor } from "../RichTextEditor";
import type { UploadingFile } from "@/hooks/useFileUpload";

function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

if (typeof URL.createObjectURL !== "function") {
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: () => "blob:mock",
  });
}

function uploadingImage(): UploadingFile {
  return {
    id: "f-1",
    file: new File(["x"], "shot.png", { type: "image/png" }),
    progress: 30,
    status: "uploading",
  } as UploadingFile;
}

function getEditable(): HTMLElement {
  const editable = document.querySelector(
    '[contenteditable="true"], [contenteditable="false"]',
  );
  if (!editable) throw new Error("editable element not found");
  return editable as HTMLElement;
}

describe("RichTextEditor — upload vs disabled", () => {
  it("keeps the editor editable while files are uploading", async () => {
    renderWithQuery(
      <RichTextEditor
        onSubmit={vi.fn()}
        isUploading
        uploadingFiles={[uploadingImage()]}
        onRemoveFile={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(getEditable().getAttribute("contenteditable")).toBe("true");
    });
  });

  it("disables the send button while uploading even if attachments are queued", async () => {
    renderWithQuery(
      <RichTextEditor
        onSubmit={vi.fn()}
        isUploading
        uploadingFiles={[
          {
            id: "done",
            file: new File(["x"], "ok.png", { type: "image/png" }),
            progress: 100,
            status: "completed",
          } as UploadingFile,
        ]}
        onRemoveFile={vi.fn()}
      />,
    );

    const sendBtn = await screen.findByTitle("Send message");
    expect(sendBtn).toBeDisabled();
  });

  it("disables the editor itself only when `disabled` is true", async () => {
    renderWithQuery(
      <RichTextEditor
        onSubmit={vi.fn()}
        disabled
        uploadingFiles={[]}
        onRemoveFile={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(getEditable().getAttribute("contenteditable")).toBe("false");
    });
  });
});

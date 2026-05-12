import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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

  it("shows a narrow minimal model menu in bot DMs", async () => {
    renderWithQuery(
      <RichTextEditor
        onSubmit={vi.fn()}
        isBotDm
        botModelSwitch={
          {
            canSwitchModel: true,
            isUpdating: false,
            currentModelLabel: "Gemini 3.1 Pro (Preview)",
            currentModel: { provider: "google", id: "gemini-3.1-pro" },
            agentModelFamily: null,
            updateModel: vi.fn(),
          } as any
        }
      />,
    );

    fireEvent.pointerDown(
      screen.getByRole("button", { name: /gemini 3.1 pro/i }),
    );

    expect(await screen.findAllByText("Gemini 3.1 Pro")).toHaveLength(2);
    expect(screen.getByText("Gemini 3 Flash")).toBeInTheDocument();
    expect(screen.queryByText(/preview/i)).not.toBeInTheDocument();
    expect(screen.getByRole("menu")).toHaveClass("w-max");
    expect(screen.getByRole("menu")).not.toHaveClass("w-[12.5rem]");

    const menu = within(screen.getByRole("menu"));
    expect(menu.getAllByRole("img", { name: "Claude logo" })).toHaveLength(2);
    expect(menu.getAllByRole("img", { name: "ChatGPT logo" })).toHaveLength(2);
    expect(menu.getAllByRole("img", { name: "Gemini logo" })).toHaveLength(2);
    expect(menu.getByRole("img", { name: "Qwen logo" })).toBeInTheDocument();
    expect(menu.getByRole("img", { name: "GLM logo" })).toBeInTheDocument();
    expect(menu.getByRole("img", { name: "Kimi logo" })).toBeInTheDocument();
  });
});

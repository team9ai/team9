import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren, ReactElement } from "react";
import { MessageAttachments } from "../MessageAttachments";
import { fileApi } from "@/services/api/file";
import type { MessageAttachment } from "@/types/im";

vi.mock("@/services/api/file", () => ({
  fileApi: {
    getDownloadUrl: vi.fn(),
  },
}));

// MessageAttachments uses `useQuery` (see the signed-URL cache in
// `useFileDownloadUrl`). Without a client the hook throws "No QueryClient
// set" on first render, so every test in this file needs its own provider
// — a fresh QueryClient per test guarantees caches don't leak between
// cases and keeps retry disabled so mocked rejections surface immediately.
function renderWithQueryClient(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const Wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(ui, { wrapper: Wrapper });
}

function makeImageAttachment(
  overrides: Partial<MessageAttachment> = {},
): MessageAttachment {
  return {
    id: "attachment-1",
    messageId: "message-1",
    fileKey: "file-1",
    fileName: "image.png",
    fileUrl: "https://cdn.test/original.png",
    mimeType: "image/png",
    fileSize: 1024,
    width: 160,
    height: 120,
    createdAt: "2026-04-02T00:00:00Z",
    ...overrides,
  };
}

function makeFileAttachment(
  overrides: Partial<MessageAttachment> = {},
): MessageAttachment {
  return {
    id: "attachment-file-1",
    messageId: "message-1",
    fileKey: "file-doc-1",
    fileName: "划船机brief.docx",
    fileUrl: "https://cdn.test/doc.docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    fileSize: 10957,
    createdAt: "2026-04-02T00:00:00Z",
    ...overrides,
  };
}

describe("MessageAttachments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders document attachments with a readable file type and named download action", () => {
    renderWithQueryClient(
      <MessageAttachments attachments={[makeFileAttachment()]} />,
    );

    expect(screen.getByText("划船机brief.docx")).toBeInTheDocument();
    expect(screen.getByText("10.7 KB")).toBeInTheDocument();
    expect(screen.getByText("DOCX")).toBeInTheDocument();
    const downloadButton = screen.getByRole("button", {
      name: "Download 划船机brief.docx",
    });
    expect(downloadButton).toBeInTheDocument();
    const card = downloadButton.parentElement!;
    expect(card).not.toHaveClass("shadow-sm");
    expect(card.className).not.toContain("hover:bg");
    expect(card.className).not.toContain("duration-150");
    expect(card.className).not.toContain("duration-300");
    expect(card.className).toContain("duration-[360ms]");
    expect(card.className).toContain("ease-in-out");
    expect(card.className).toContain("hover:-translate-y-px");
    expect(card.className).toContain("hover:scale-[1.005]");
    expect(card.className).toContain(
      "hover:shadow-[0_5px_14px_rgba(15,23,42,0.08)]",
    );
  });

  it("reloads the preview when the file key changes in the same slot", async () => {
    const getDownloadUrl = vi.mocked(fileApi.getDownloadUrl);
    getDownloadUrl
      .mockResolvedValueOnce({
        url: "https://cdn.test/image-1.png",
        expiresAt: "2026-04-03T00:00:00Z",
      })
      .mockResolvedValueOnce({
        url: "https://cdn.test/image-2.png",
        expiresAt: "2026-04-03T00:00:00Z",
      });

    const { rerender } = renderWithQueryClient(
      <MessageAttachments attachments={[makeImageAttachment()]} />,
    );

    await waitFor(() => {
      expect(getDownloadUrl).toHaveBeenCalledWith("file-1");
    });
    await waitFor(() => {
      expect(screen.getByRole("img", { name: "image.png" })).toHaveAttribute(
        "src",
        "https://cdn.test/image-1.png",
      );
    });

    rerender(
      <MessageAttachments
        attachments={[
          makeImageAttachment({
            fileKey: "file-2",
          }),
        ]}
      />,
    );

    await waitFor(() => {
      expect(getDownloadUrl).toHaveBeenLastCalledWith("file-2");
    });
    await waitFor(() => {
      expect(screen.getByRole("img", { name: "image.png" })).toHaveAttribute(
        "src",
        "https://cdn.test/image-2.png",
      );
    });
  });
});

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

describe("MessageAttachments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useFileUpload } from "../useFileUpload";

const mockCreatePresignedUpload = vi.hoisted(() => vi.fn());
const mockUploadToS3 = vi.hoisted(() => vi.fn());
const mockConfirmUpload = vi.hoisted(() => vi.fn());

vi.mock("@/services/api/file", () => ({
  fileApi: {
    createPresignedUpload: mockCreatePresignedUpload,
    uploadToS3: mockUploadToS3,
    confirmUpload: mockConfirmUpload,
  },
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });

  return function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe("useFileUpload", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockCreatePresignedUpload.mockResolvedValue({
      url: "https://uploads.test",
      key: "uploads/file.png",
      fields: { key: "uploads/file.png" },
      publicUrl: "https://cdn.test/uploads/file.png",
    });
  });

  it("aborts an in-progress upload when the file is removed", async () => {
    const onError = vi.fn();
    let uploadSignal: AbortSignal | undefined;
    let rejectUpload: ((error: Error) => void) | undefined;

    mockUploadToS3.mockImplementation(
      (
        _url: string,
        _file: File,
        _fields: Record<string, string>,
        _onProgress: (progress: number) => void,
        signal?: AbortSignal,
      ) => {
        uploadSignal = signal;
        signal?.addEventListener("abort", () => {
          rejectUpload?.(new DOMException("Aborted", "AbortError"));
        });

        return new Promise<void>((_resolve, reject) => {
          rejectUpload = reject;
        });
      },
    );

    const { result } = renderHook(
      () => useFileUpload({ visibility: "workspace", onError }),
      { wrapper: createWrapper() },
    );
    const file = new File(["image"], "image.png", { type: "image/png" });

    act(() => {
      result.current.addFiles([file]);
    });

    await waitFor(() => {
      expect(mockUploadToS3).toHaveBeenCalledWith(
        "https://uploads.test",
        file,
        { key: "uploads/file.png" },
        expect.any(Function),
        expect.any(AbortSignal),
      );
    });

    const uploadId = result.current.uploadingFiles[0]?.id;
    expect(uploadId).toBeTruthy();

    act(() => {
      result.current.removeFile(uploadId as string);
    });

    await waitFor(() => {
      expect(uploadSignal?.aborted).toBe(true);
    });

    expect(result.current.uploadingFiles).toEqual([]);
    expect(onError).not.toHaveBeenCalled();
    expect(mockConfirmUpload).not.toHaveBeenCalled();
  });
});

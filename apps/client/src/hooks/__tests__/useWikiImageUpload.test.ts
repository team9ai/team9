import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks ---------------------------------------------------------------
//
// The hook reaches out to `wikisApi.commit` via the services barrel. Replace
// it with a Vitest mock we can inspect per-test. `vi.hoisted` keeps the
// object reference stable across re-renders so the hook always sees our
// latest resolved/rejected value.
const mockWikisApi = vi.hoisted(() => ({
  commit: vi.fn(),
}));

vi.mock("@/services/api/wikis", () => ({
  wikisApi: mockWikisApi,
}));

import { useWikiImageUpload } from "../useWikiImageUpload";

// --- Helpers -------------------------------------------------------------

/**
 * Minimal `File` polyfill for jsdom. jsdom ships `Blob` and `File` but the
 * `File` constructor there stores `lastModified` + `name`; for our purposes we
 * only care about `name`, `size`, and `type`, all of which are honoured.
 */
function makeFile(
  name: string,
  opts: { type?: string; size?: number } = {},
): File {
  const bytes = new Uint8Array(opts.size ?? 4);
  return new File([bytes], name, {
    type: opts.type ?? "image/png",
  });
}

/**
 * Stub out `FileReader.readAsDataURL` so we don't depend on jsdom's real
 * (async) implementation. Returning a fixed data URL lets us assert the
 * base64 prefix-stripping logic deterministically.
 */
function stubFileReader(dataUrl: string | null, { fail = false } = {}) {
  class StubFileReader {
    result: unknown = null;
    error: unknown = null;
    onload: ((this: FileReader, ev: ProgressEvent<FileReader>) => void) | null =
      null;
    onerror:
      | ((this: FileReader, ev: ProgressEvent<FileReader>) => void)
      | null = null;
    readAsDataURL() {
      // Fire asynchronously to mimic the real FileReader contract (the hook
      // awaits a Promise so we don't actually need microtask semantics — a
      // queueMicrotask is enough to exercise the real code path).
      queueMicrotask(() => {
        if (fail) {
          this.error = new Error("read failure");
          this.onerror?.call(
            this as unknown as FileReader,
            {} as ProgressEvent<FileReader>,
          );
          return;
        }
        this.result = dataUrl;
        this.onload?.call(
          this as unknown as FileReader,
          {} as ProgressEvent<FileReader>,
        );
      });
    }
  }
  vi.stubGlobal("FileReader", StubFileReader);
}

/** Deterministic UUID sequence so path assertions are stable. */
function stubUuids(values: string[]) {
  let i = 0;
  vi.stubGlobal("crypto", {
    ...globalThis.crypto,
    randomUUID: () => {
      const v = values[i] ?? `fallback-${i}`;
      i += 1;
      return v;
    },
  });
}

// --- Tests ---------------------------------------------------------------

describe("useWikiImageUpload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    stubFileReader("data:image/png;base64,ZmFrZS1pbWFnZQ==");
    stubUuids(["uuid-1"]);
    mockWikisApi.commit.mockResolvedValue({
      commit: { sha: "sha-1" },
      proposal: null,
    });
  });

  it("exposes initial uploading=false", () => {
    const { result } = renderHook(() => useWikiImageUpload("wiki-1"));
    expect(result.current.uploading).toBe(false);
  });

  it("uploads a valid image and returns the committed path", async () => {
    const { result } = renderHook(() => useWikiImageUpload("wiki-1"));
    const file = makeFile("photo.png", { type: "image/png" });

    let returned: string | undefined;
    await act(async () => {
      returned = await result.current.upload(file, "attachments");
    });

    expect(returned).toBe("attachments/uuid-1.png");
    expect(mockWikisApi.commit).toHaveBeenCalledTimes(1);
    expect(mockWikisApi.commit).toHaveBeenCalledWith("wiki-1", {
      message: "Upload photo.png",
      files: [
        {
          path: "attachments/uuid-1.png",
          content: "ZmFrZS1pbWFnZQ==",
          encoding: "base64",
          action: "create",
        },
      ],
    });
    expect(result.current.uploading).toBe(false);
  });

  it("flips uploading to true while the commit is in flight and back to false on success", async () => {
    // Delay the commit so we can observe the in-flight state.
    let resolveCommit: (v: unknown) => void = () => {};
    mockWikisApi.commit.mockReturnValue(
      new Promise((resolve) => {
        resolveCommit = resolve;
      }),
    );

    const { result } = renderHook(() => useWikiImageUpload("wiki-1"));
    const file = makeFile("photo.png");

    let uploadPromise!: Promise<string>;
    await act(async () => {
      uploadPromise = result.current.upload(file, "attachments");
      // Wait a microtask cycle for the FileReader stub + setState to flush.
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.uploading).toBe(true));

    await act(async () => {
      resolveCommit({ commit: { sha: "x" }, proposal: null });
      await uploadPromise;
    });
    expect(result.current.uploading).toBe(false);
  });

  it("rejects files larger than 5 MB without invoking the commit API", async () => {
    const { result } = renderHook(() => useWikiImageUpload("wiki-1"));
    const oversize = makeFile("big.png", { size: 5 * 1024 * 1024 + 1 });

    await expect(
      act(async () => {
        await result.current.upload(oversize, "attachments");
      }),
    ).rejects.toThrow("File too large (max 5 MB)");

    expect(mockWikisApi.commit).not.toHaveBeenCalled();
    expect(result.current.uploading).toBe(false);
  });

  it("accepts a file exactly 5 MB (boundary is strictly greater-than)", async () => {
    const { result } = renderHook(() => useWikiImageUpload("wiki-1"));
    const boundary = makeFile("edge.png", { size: 5 * 1024 * 1024 });

    await act(async () => {
      await result.current.upload(boundary, "attachments");
    });
    expect(mockWikisApi.commit).toHaveBeenCalledTimes(1);
  });

  it("rejects when basePath is empty/whitespace", async () => {
    const { result } = renderHook(() => useWikiImageUpload("wiki-1"));
    const file = makeFile("photo.png");
    await expect(
      act(async () => {
        await result.current.upload(file, "   ");
      }),
    ).rejects.toThrow("Upload path is required");
    expect(mockWikisApi.commit).not.toHaveBeenCalled();
  });

  it("resets uploading to false when the commit rejects, and surfaces the error", async () => {
    mockWikisApi.commit.mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useWikiImageUpload("wiki-1"));
    const file = makeFile("photo.png");

    await expect(
      act(async () => {
        await result.current.upload(file, "attachments");
      }),
    ).rejects.toThrow("network down");
    expect(result.current.uploading).toBe(false);
  });

  it("propagates FileReader errors", async () => {
    stubFileReader(null, { fail: true });
    const { result } = renderHook(() => useWikiImageUpload("wiki-1"));
    const file = makeFile("photo.png");

    await expect(
      act(async () => {
        await result.current.upload(file, "attachments");
      }),
    ).rejects.toThrow("read failure");
    expect(mockWikisApi.commit).not.toHaveBeenCalled();
    expect(result.current.uploading).toBe(false);
  });

  it("falls back to extension 'bin' for files without an extension", async () => {
    stubUuids(["uuid-noext"]);
    const { result } = renderHook(() => useWikiImageUpload("wiki-1"));
    const file = makeFile("noextension", { type: "image/png" });

    await act(async () => {
      await result.current.upload(file, "attachments");
    });

    const call = mockWikisApi.commit.mock.calls[0][1] as {
      files: Array<{ path: string }>;
    };
    expect(call.files[0].path).toBe("attachments/uuid-noext.bin");
  });

  it("falls back to 'bin' when filename starts with a dot (no real extension)", async () => {
    stubUuids(["uuid-dotfile"]);
    const { result } = renderHook(() => useWikiImageUpload("wiki-1"));
    // `.hidden` — dotIdx === 0 → treat as no extension
    const file = makeFile(".hidden", { type: "image/png" });
    await act(async () => {
      await result.current.upload(file, "attachments");
    });
    const call = mockWikisApi.commit.mock.calls[0][1] as {
      files: Array<{ path: string }>;
    };
    expect(call.files[0].path).toBe("attachments/uuid-dotfile.bin");
  });

  it("falls back to 'bin' when filename ends with a trailing dot", async () => {
    stubUuids(["uuid-trailing"]);
    const { result } = renderHook(() => useWikiImageUpload("wiki-1"));
    const file = makeFile("weird.", { type: "image/png" });
    await act(async () => {
      await result.current.upload(file, "attachments");
    });
    const call = mockWikisApi.commit.mock.calls[0][1] as {
      files: Array<{ path: string }>;
    };
    expect(call.files[0].path).toBe("attachments/uuid-trailing.bin");
  });

  it("generates a unique path for each sequential upload", async () => {
    stubUuids(["uuid-a", "uuid-b", "uuid-c"]);
    const { result } = renderHook(() => useWikiImageUpload("wiki-1"));

    await act(async () => {
      await result.current.upload(makeFile("a.png"), "attachments");
    });
    await act(async () => {
      await result.current.upload(makeFile("b.jpg"), "attachments");
    });
    await act(async () => {
      await result.current.upload(makeFile("c.gif"), "attachments");
    });

    const paths = mockWikisApi.commit.mock.calls.map(
      (c) => (c[1] as { files: Array<{ path: string }> }).files[0].path,
    );
    expect(paths).toEqual([
      "attachments/uuid-a.png",
      "attachments/uuid-b.jpg",
      "attachments/uuid-c.gif",
    ]);
  });

  it("supports the .team9/covers basePath (future cover upload flow)", async () => {
    stubUuids(["uuid-cover"]);
    const { result } = renderHook(() => useWikiImageUpload("wiki-1"));

    await act(async () => {
      await result.current.upload(makeFile("hero.jpg"), ".team9/covers");
    });

    const call = mockWikisApi.commit.mock.calls[0][1] as {
      message: string;
      files: Array<{ path: string }>;
    };
    expect(call.files[0].path).toBe(".team9/covers/uuid-cover.jpg");
    expect(call.message).toBe("Upload hero.jpg");
  });

  it("strips the data URL prefix so only the base64 payload is uploaded", async () => {
    stubFileReader("data:image/jpeg;base64,SGVsbG8sV29ybGQ=");
    const { result } = renderHook(() => useWikiImageUpload("wiki-1"));

    await act(async () => {
      await result.current.upload(makeFile("x.jpg"), "attachments");
    });

    const call = mockWikisApi.commit.mock.calls[0][1] as {
      files: Array<{ content: string }>;
    };
    expect(call.files[0].content).toBe("SGVsbG8sV29ybGQ=");
  });

  it("returns an empty payload when FileReader yields a string without a comma", async () => {
    stubFileReader("no-data-url-prefix");
    const { result } = renderHook(() => useWikiImageUpload("wiki-1"));

    await act(async () => {
      await result.current.upload(makeFile("x.png"), "attachments");
    });

    const call = mockWikisApi.commit.mock.calls[0][1] as {
      files: Array<{ content: string }>;
    };
    expect(call.files[0].content).toBe("");
  });

  it("returns an empty payload when FileReader yields a non-string result", async () => {
    // Simulate a degenerate FileReader that resolves with a Blob / ArrayBuffer.
    class WeirdReader {
      result: unknown = new ArrayBuffer(4);
      error: unknown = null;
      onload:
        | ((this: FileReader, ev: ProgressEvent<FileReader>) => void)
        | null = null;
      onerror:
        | ((this: FileReader, ev: ProgressEvent<FileReader>) => void)
        | null = null;
      readAsDataURL() {
        queueMicrotask(() =>
          this.onload?.call(
            this as unknown as FileReader,
            {} as ProgressEvent<FileReader>,
          ),
        );
      }
    }
    vi.stubGlobal("FileReader", WeirdReader);
    const { result } = renderHook(() => useWikiImageUpload("wiki-1"));

    await act(async () => {
      await result.current.upload(makeFile("x.png"), "attachments");
    });

    const call = mockWikisApi.commit.mock.calls[0][1] as {
      files: Array<{ content: string }>;
    };
    expect(call.files[0].content).toBe("");
  });

  it("propagates the FileReader error even if `reader.error` is missing", async () => {
    class BareReader {
      result: unknown = null;
      error: unknown = null;
      onload:
        | ((this: FileReader, ev: ProgressEvent<FileReader>) => void)
        | null = null;
      onerror:
        | ((this: FileReader, ev: ProgressEvent<FileReader>) => void)
        | null = null;
      readAsDataURL() {
        queueMicrotask(() =>
          this.onerror?.call(
            this as unknown as FileReader,
            {} as ProgressEvent<FileReader>,
          ),
        );
      }
    }
    vi.stubGlobal("FileReader", BareReader);
    const { result } = renderHook(() => useWikiImageUpload("wiki-1"));

    await expect(
      act(async () => {
        await result.current.upload(makeFile("x.png"), "attachments");
      }),
    ).rejects.toThrow("Failed to read file");
    expect(result.current.uploading).toBe(false);
  });
});

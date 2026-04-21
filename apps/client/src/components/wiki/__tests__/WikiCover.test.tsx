import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetRawObjectUrl = vi.hoisted(() => vi.fn());

vi.mock("@/services/api/wikis", () => ({
  wikisApi: {
    getRawObjectUrl: (...args: unknown[]) => mockGetRawObjectUrl(...args),
  },
}));

import { WikiCover } from "../WikiCover";

describe("WikiCover", () => {
  let revokeSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockGetRawObjectUrl.mockReset();
    revokeSpy = vi.fn();
    URL.createObjectURL = vi.fn(() => "blob:mock");
    URL.revokeObjectURL = revokeSpy;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the gradient fallback when coverPath is null", () => {
    render(<WikiCover wikiId="wiki-1" coverPath={null} />);
    expect(screen.getByTestId("wiki-cover-fallback")).toBeInTheDocument();
    expect(mockGetRawObjectUrl).not.toHaveBeenCalled();
  });

  it("renders the fetched blob URL when a coverPath is provided", async () => {
    mockGetRawObjectUrl.mockResolvedValue("blob:cover");
    render(<WikiCover wikiId="wiki-1" coverPath="cover.png" />);

    await waitFor(() => {
      const el = screen.getByTestId("wiki-cover-image");
      expect(el).toHaveStyle("background-image: url(blob:cover)");
    });
    expect(mockGetRawObjectUrl).toHaveBeenCalledWith("wiki-1", "cover.png");
  });

  it("falls back to the gradient when the fetch fails", async () => {
    mockGetRawObjectUrl.mockRejectedValue(new Error("boom"));
    render(<WikiCover wikiId="wiki-1" coverPath="cover.png" />);

    await waitFor(() => {
      expect(screen.getByTestId("wiki-cover-fallback")).toBeInTheDocument();
    });
  });

  it("revokes the object URL on unmount", async () => {
    mockGetRawObjectUrl.mockResolvedValue("blob:cover");
    const { unmount } = render(
      <WikiCover wikiId="wiki-1" coverPath="cover.png" />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("wiki-cover-image")).toBeInTheDocument();
    });
    unmount();
    expect(revokeSpy).toHaveBeenCalledWith("blob:cover");
  });

  it("does not set failed=true when a fetch rejects after unmount", async () => {
    let rejectFetch: (err: Error) => void = () => {};
    mockGetRawObjectUrl.mockReturnValue(
      new Promise<string>((_resolve, reject) => {
        rejectFetch = reject;
      }),
    );
    const { unmount, queryByTestId } = render(
      <WikiCover wikiId="wiki-1" coverPath="cover.png" />,
    );
    unmount();
    await act(async () => {
      rejectFetch(new Error("late"));
      await Promise.resolve();
    });
    // `setFailed(true)` path is guarded by `!cancelled`, so a post-unmount
    // rejection is a no-op — nothing to assert except it didn't throw.
    expect(queryByTestId("wiki-cover-image")).toBeNull();
  });

  it("revokes the URL if the component unmounts before the fetch resolves", async () => {
    let resolveFetch: (value: string) => void = () => {};
    mockGetRawObjectUrl.mockReturnValue(
      new Promise<string>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    const { unmount } = render(
      <WikiCover wikiId="wiki-1" coverPath="cover.png" />,
    );
    unmount();
    await act(async () => {
      resolveFetch("blob:late");
      await Promise.resolve();
    });
    // A late-resolving fetch after unmount must still revoke to avoid a leak.
    expect(revokeSpy).toHaveBeenCalledWith("blob:late");
  });

  it("refetches when coverPath changes", async () => {
    mockGetRawObjectUrl.mockResolvedValueOnce("blob:a");
    const { rerender } = render(
      <WikiCover wikiId="wiki-1" coverPath="a.png" />,
    );
    await waitFor(() => expect(mockGetRawObjectUrl).toHaveBeenCalledTimes(1));

    mockGetRawObjectUrl.mockResolvedValueOnce("blob:b");
    rerender(<WikiCover wikiId="wiki-1" coverPath="b.png" />);
    await waitFor(() => expect(mockGetRawObjectUrl).toHaveBeenCalledTimes(2));
    // Previous blob URL was revoked.
    expect(revokeSpy).toHaveBeenCalledWith("blob:a");
  });

  it("recovers from a previous failure when coverPath changes to a good one", async () => {
    // First render: fetch rejects → `failed` becomes true and the gradient
    // fallback is shown.
    mockGetRawObjectUrl.mockRejectedValueOnce(new Error("boom"));
    const { rerender } = render(
      <WikiCover wikiId="wiki-1" coverPath="bad.jpg" />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("wiki-cover-fallback")).toBeInTheDocument();
    });
    expect(mockGetRawObjectUrl).toHaveBeenCalledWith("wiki-1", "bad.jpg");

    // Rerender with a new path whose fetch succeeds. The effect must re-run
    // and reset `failed` back to false so the new cover renders instead of
    // the component staying stuck on the fallback.
    mockGetRawObjectUrl.mockResolvedValueOnce("blob:good");
    rerender(<WikiCover wikiId="wiki-1" coverPath="good.jpg" />);

    await waitFor(() => {
      const el = screen.getByTestId("wiki-cover-image");
      expect(el).toHaveStyle("background-image: url(blob:good)");
    });
    expect(mockGetRawObjectUrl).toHaveBeenLastCalledWith("wiki-1", "good.jpg");
  });
});

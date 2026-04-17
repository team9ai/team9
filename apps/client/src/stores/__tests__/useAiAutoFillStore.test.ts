import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "@testing-library/react";
import { useAiAutoFillStore } from "../useAiAutoFillStore";

const autoFillMock = vi.fn();

vi.mock("@/services/api/properties", () => ({
  aiAutoFillApi: {
    autoFill: (...args: unknown[]) => autoFillMock(...args),
  },
}));

function reset() {
  act(() => {
    useAiAutoFillStore.setState({ entries: new Map() });
  });
}

describe("useAiAutoFillStore", () => {
  beforeEach(() => {
    autoFillMock.mockReset();
    reset();
  });

  it("tracks loading → info when AI returns empty filled map", async () => {
    autoFillMock.mockResolvedValue({ filled: {}, skipped: [] });

    const p = useAiAutoFillStore.getState().run("msg-1");
    expect(useAiAutoFillStore.getState().getEntry("msg-1")?.status).toBe(
      "loading",
    );

    await act(async () => {
      await p;
    });

    expect(useAiAutoFillStore.getState().getEntry("msg-1")).toMatchObject({
      status: "info",
      message: "Nothing to fill",
    });
  });

  it("tracks loading → idle (undefined) when AI actually fills fields", async () => {
    autoFillMock.mockResolvedValue({ filled: { status: "open" }, skipped: [] });

    await act(async () => {
      await useAiAutoFillStore.getState().run("msg-2");
    });

    // Filled path → no persistent entry (UI refresh via WS handles rest)
    expect(useAiAutoFillStore.getState().getEntry("msg-2")).toBeUndefined();
  });

  it("tracks loading → error on rejection and keeps error until dismissed", async () => {
    autoFillMock.mockRejectedValue(new Error("boom"));

    await act(async () => {
      try {
        await useAiAutoFillStore.getState().run("msg-3");
      } catch {
        /* swallowed by store */
      }
    });

    const entry = useAiAutoFillStore.getState().getEntry("msg-3");
    expect(entry?.status).toBe("error");

    act(() => {
      useAiAutoFillStore.getState().dismiss("msg-3");
    });
    expect(useAiAutoFillStore.getState().getEntry("msg-3")).toBeUndefined();
  });

  it("de-duplicates concurrent runs for the same messageId", async () => {
    let resolveFn: (v: unknown) => void = () => {};
    autoFillMock.mockReturnValue(
      new Promise((r) => {
        resolveFn = r;
      }),
    );

    const p1 = useAiAutoFillStore.getState().run("msg-4");
    const p2 = useAiAutoFillStore.getState().run("msg-4");

    expect(autoFillMock).toHaveBeenCalledTimes(1);
    expect(p1).toBe(p2);

    await act(async () => {
      resolveFn({ filled: { a: 1 }, skipped: [] });
      await p1;
    });
  });

  it("forwards fields and preserveExisting options", async () => {
    autoFillMock.mockResolvedValue({ filled: { a: 1 }, skipped: [] });

    await act(async () => {
      await useAiAutoFillStore
        .getState()
        .run("msg-5", { fields: ["a"], preserveExisting: true });
    });

    expect(autoFillMock).toHaveBeenCalledWith("msg-5", {
      fields: ["a"],
      preserveExisting: true,
    });
  });
});

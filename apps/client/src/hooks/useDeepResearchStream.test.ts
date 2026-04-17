import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useDeepResearchStream } from "./useDeepResearchStream";
import { useDeepResearchStore } from "@/stores/useDeepResearchStore";

function makeSseResponse(chunks: string[]): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(c) {
      for (const s of chunks) c.enqueue(enc.encode(s));
      c.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

describe("useDeepResearchStream", () => {
  beforeEach(() => {
    useDeepResearchStore.getState().reset();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("parses events and pushes into store", async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeSseResponse([
        "id: 1\nevent: interaction.start\ndata: {}\n\n",
        'id: 2\nevent: content.delta\ndata: {"type":"text","text":"hi"}\n\n',
      ]),
    );
    renderHook(() =>
      useDeepResearchStream({
        taskId: "T1",
        getAuth: async () => ({ token: "t", tenantId: "tn" }),
      }),
    );
    await waitFor(() => {
      const s = useDeepResearchStore.getState().byTaskId["T1"];
      expect(s?.lastSeq).toBe("2");
      expect(s?.markdownAccum).toBe("hi");
    });
  });

  it("sends Last-Event-ID on reconnect using store lastSeq", async () => {
    const calls: RequestInit[] = [];
    (
      globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    ).mockImplementation((_u: string, init: RequestInit) => {
      calls.push(init);
      if (calls.length === 1) {
        return Promise.resolve(
          makeSseResponse([
            'id: 5\nevent: content.delta\ndata: {"type":"text","text":"a"}\n\n',
          ]),
        );
      }
      return Promise.resolve(
        makeSseResponse(["id: 6\nevent: interaction.complete\ndata: {}\n\n"]),
      );
    });
    renderHook(() =>
      useDeepResearchStream({
        taskId: "T2",
        getAuth: async () => ({ token: "t", tenantId: "tn" }),
      }),
    );
    await waitFor(
      () => {
        expect(useDeepResearchStore.getState().byTaskId["T2"]?.status).toBe(
          "completed",
        );
      },
      { timeout: 4_000 },
    );
    const secondHeaders = (calls[1].headers as Record<string, string>) ?? {};
    expect(secondHeaders["last-event-id"]).toBe("5");
  });
});

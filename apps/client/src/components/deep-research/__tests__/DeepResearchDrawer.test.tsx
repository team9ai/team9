import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/i18n";

// Mock the API module with minimal stable resolutions.
vi.mock("@/services/api/deep-research", async () => {
  const actual = await vi.importActual<
    typeof import("@/services/api/deep-research")
  >("@/services/api/deep-research");
  return {
    ...actual,
    deepResearchApi: {
      createTask: vi.fn(async () => ({
        id: "T1",
        status: "running" as const,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
      listTasks: vi.fn(async () => ({ items: [], nextCursor: null })),
      getTask: vi.fn(async () => ({
        id: "T1",
        status: "completed" as const,
        reportUrl: "http://x/r.md",
        createdAt: "",
        updatedAt: "",
      })),
    },
  };
});

// Stub auth-session + workspace store transitive deps used by TaskDetail.
vi.mock("@/services/auth-session", () => ({
  getAuthToken: () => "test-token",
}));

vi.mock("@/stores/useWorkspaceStore", () => ({
  useWorkspaceStore: <T,>(
    selector: (s: { selectedWorkspaceId: string }) => T,
  ) => selector({ selectedWorkspaceId: "tenant-1" }),
}));

// Simulate the SSE stream by resolving fetch with a ReadableStream that yields
// start + complete, then the report-URL fetch with plain markdown.
const sseBody = (chunks: string[]): ReadableStream<Uint8Array> => {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const s of chunks) c.enqueue(enc.encode(s));
      c.close();
    },
  });
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      if (url.includes("/stream")) {
        return new Response(
          sseBody([
            "id: 1\nevent: interaction.start\ndata: {}\n\n",
            'id: 2\nevent: interaction.complete\ndata: {"reportUrl":"http://x/r.md"}\n\n',
          ]),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        );
      }
      if (url.startsWith("http://x/r.md")) {
        return new Response("# Report\n\nbody", { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }),
  );
});

describe("DeepResearchDrawer", () => {
  it("creates task, streams to completion, and inserts markdown into the editor", async () => {
    const editorUpdate = vi.fn((cb: () => void) => cb());
    const editorStub = { update: editorUpdate } as unknown as Parameters<
      typeof import("../DeepResearchDrawer").DeepResearchDrawer
    >[0]["editor"];

    // Dynamic import so the module picks up the mocks above.
    const { DeepResearchDrawer } = await import("../DeepResearchDrawer");

    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={qc}>
        <DeepResearchDrawer
          open={true}
          onOpenChange={() => {}}
          editor={editorStub}
        />
      </QueryClientProvider>,
    );

    // Find the prompt textbox and submit.
    const textarea = await screen.findByRole("textbox");
    fireEvent.change(textarea, { target: { value: "TPUs?" } });
    const startButton = screen.getByRole("button", { name: /Start|开始/ });
    fireEvent.click(startButton);

    // Wait for stream completion to trigger editor.update -> markdown insert.
    await waitFor(() => expect(editorUpdate).toHaveBeenCalled(), {
      timeout: 4_000,
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/i18n";
import { useDeepResearchStore } from "@/stores/useDeepResearchStore";

const { mockGetTask } = vi.hoisted(() => ({
  mockGetTask: vi.fn(),
}));

vi.mock("@/services/api/deep-research", () => ({
  deepResearchApi: {
    getTask: mockGetTask,
  },
}));

vi.mock("@/hooks/useDeepResearchStream", () => ({
  useDeepResearchStream: vi.fn(),
}));

vi.mock("@/services/auth-session", () => ({
  getAuthToken: () => "test-token",
}));

vi.mock("@/stores/useWorkspaceStore", () => ({
  useWorkspaceStore: <T,>(
    selector: (s: { selectedWorkspaceId: string }) => T,
  ) => selector({ selectedWorkspaceId: "tenant-1" }),
}));

describe("TaskDetail", () => {
  beforeEach(() => {
    mockGetTask.mockReset();
    useDeepResearchStore.getState().reset();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url =
          typeof input === "string" ? input : (input as URL).toString();
        if (url === "http://x/report.md") {
          return new Response("# Report", { status: 200 });
        }
        return new Response("{}", { status: 200 });
      }),
    );
  });

  it("prefers terminal stream status and refetches task data", async () => {
    mockGetTask.mockResolvedValue({
      id: "T1",
      status: "running",
      prompt: "topic",
      reportUrl: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    useDeepResearchStore.setState({
      byTaskId: {
        T1: {
          status: "running",
          thoughts: [],
          truncatedThoughts: 0,
          markdownAccum: "",
          lastSeq: "9",
          unknownCount: 0,
          unknownSamples: [],
        },
      },
    });

    const { TaskDetail } = await import("../TaskDetail");
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <TaskDetail taskId="T1" />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Running")).toBeInTheDocument();

    await act(async () => {
      useDeepResearchStore.setState({
        byTaskId: {
          T1: {
            status: "completed",
            thoughts: [],
            truncatedThoughts: 0,
            markdownAccum: "",
            reportUrl: "http://x/report.md",
            lastSeq: "10",
            unknownCount: 0,
            unknownSamples: [],
          },
        },
      });
    });

    expect(await screen.findByText("Completed")).toBeInTheDocument();
    await waitFor(() => {
      expect(mockGetTask).toHaveBeenCalledTimes(2);
    });
  });
});

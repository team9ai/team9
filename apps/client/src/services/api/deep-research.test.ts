import { describe, it, expect, vi, beforeEach } from "vitest";
import http from "@/services/http";
import { deepResearchApi } from "./deep-research";

vi.mock("@/services/http", () => ({
  default: {
    post: vi.fn(),
    get: vi.fn(),
  },
}));

describe("deepResearchApi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("createTask posts to /v1/deep-research/tasks", async () => {
    (http.post as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { id: "t1", status: "pending", createdAt: "", updatedAt: "" },
    });
    const t = await deepResearchApi.createTask({ input: "hi" });
    expect(http.post).toHaveBeenCalledWith("/v1/deep-research/tasks", {
      input: "hi",
    });
    expect(t.id).toBe("t1");
  });

  it("startInChannel posts to the IM deep-research endpoint", async () => {
    (http.post as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        task: { id: "t-chat-1", status: "running" },
        message: { id: "msg-1", content: "research this market" },
      },
    });

    const result = await deepResearchApi.startInChannel("channel-1", {
      input: "research this market",
      origin: "dashboard",
    });

    expect(http.post).toHaveBeenCalledWith(
      "/v1/im/channels/channel-1/deep-research",
      {
        input: "research this market",
        origin: "dashboard",
      },
    );
    expect(result.task.id).toBe("t-chat-1");
    expect(result.message.id).toBe("msg-1");
  });

  it("listTasks passes params", async () => {
    (http.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { items: [], nextCursor: null },
    });
    await deepResearchApi.listTasks({ limit: 20 });
    expect(http.get).toHaveBeenCalledWith("/v1/deep-research/tasks", {
      params: { limit: 20 },
    });
  });

  it("getTask hits by id", async () => {
    (http.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        success: true,
        data: {
          id: "abc",
          status: "completed",
          createdAt: "2026-04-13T00:00:00.000Z",
          updatedAt: "2026-04-13T01:00:00.000Z",
          input: "Research prompt",
          finalReport: { url: "https://example.com/report.md" },
        },
      },
    });
    const t = await deepResearchApi.getTask("abc");
    expect(http.get).toHaveBeenCalledWith("/v1/deep-research/tasks/abc");
    expect(t.id).toBe("abc");
    expect(t.prompt).toBe("Research prompt");
    expect(t.reportUrl).toBe("https://example.com/report.md");
  });

  it("unwraps capability-hub {success,data} envelope for listTasks", async () => {
    (http.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        success: true,
        data: {
          items: [
            { id: "x1", status: "pending", createdAt: "", updatedAt: "" },
          ],
          nextCursor: null,
        },
      },
    });
    const r = await deepResearchApi.listTasks();
    expect(r.items).toHaveLength(1);
    expect(r.items[0].id).toBe("x1");
    expect(r.nextCursor).toBeNull();
  });
});

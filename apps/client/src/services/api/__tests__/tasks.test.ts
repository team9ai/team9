import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskRun } from "@/types/task";

const mockHttp = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("../../http", () => ({
  __esModule: true,
  default: mockHttp,
}));

import { tasksApi } from "../tasks";

describe("tasksApi", () => {
  beforeEach(() => {
    mockHttp.get.mockReset();
    mockHttp.post.mockReset();
    mockHttp.patch.mockReset();
    mockHttp.delete.mockReset();
  });

  it("renames native task runs", async () => {
    const task = { id: "task-1", title: "Renamed task" } as TaskRun;
    mockHttp.patch.mockResolvedValueOnce({ data: task });

    const result = await tasksApi.update("task-1", {
      title: "Renamed task",
    });

    expect(mockHttp.patch).toHaveBeenCalledWith("/v1/tasks/task-1", {
      title: "Renamed task",
    });
    expect(result).toEqual(task);
  });

  it("hides, unhides, archives, and deletes native task runs", async () => {
    mockHttp.post
      .mockResolvedValueOnce({ data: { id: "task-1", hiddenAt: "now" } })
      .mockResolvedValueOnce({ data: { id: "task-1", hiddenAt: null } })
      .mockResolvedValueOnce({ data: { id: "task-1", archivedAt: "now" } });
    mockHttp.delete.mockResolvedValueOnce({ data: { success: true } });

    await tasksApi.hide("task-1");
    await tasksApi.unhide("task-1");
    await tasksApi.archive("task-1");
    await tasksApi.delete("task-1");

    expect(mockHttp.post).toHaveBeenNthCalledWith(1, "/v1/tasks/task-1/hide");
    expect(mockHttp.post).toHaveBeenNthCalledWith(2, "/v1/tasks/task-1/unhide");
    expect(mockHttp.post).toHaveBeenNthCalledWith(
      3,
      "/v1/tasks/task-1/archive",
    );
    expect(mockHttp.delete).toHaveBeenCalledWith("/v1/tasks/task-1");
  });
});

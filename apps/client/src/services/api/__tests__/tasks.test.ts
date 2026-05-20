import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Routine, RoutineDetail } from "@/types/routine";
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

function taskRouteNotFound(method: "GET" | "POST", path = "/api/v1/tasks") {
  const error = new Error("Request failed with status 404") as Error & {
    status: number;
    response: {
      status: number;
      data: { message: string; statusCode: number };
    };
  };
  error.status = 404;
  error.response = {
    status: 404,
    data: {
      message: `Cannot ${method} ${path}`,
      statusCode: 404,
    },
  };
  return error;
}

const routine: Routine = {
  id: "routine-1",
  tenantId: "tenant-1",
  botId: "bot-1",
  creatorId: "user-1",
  title: "找 20 位 KOC",
  description: "整理首轮触达建议",
  status: "upcoming",
  scheduleType: "once",
  scheduleConfig: null,
  nextRunAt: null,
  version: 3,
  documentId: "doc-1",
  folderId: "folder-1",
  currentExecutionId: null,
  tokenUsage: 88,
  creationChannelId: null,
  creationSessionId: null,
  sourceRef: null,
  createdAt: "2026-05-19T00:00:00.000Z",
  updatedAt: "2026-05-19T00:01:00.000Z",
};

const routineDetail: RoutineDetail = {
  ...routine,
  currentExecution: {
    execution: {
      id: "exec-1",
      routineId: routine.id,
      routineVersion: routine.version,
      status: "completed",
      channelId: "channel-1",
      taskcastTaskId: "taskcast-1",
      tokenUsage: 99,
      triggerId: null,
      triggerType: null,
      triggerContext: null,
      documentVersionId: null,
      sourceExecutionId: null,
      startedAt: "2026-05-19T00:02:00.000Z",
      completedAt: "2026-05-19T00:03:00.000Z",
      duration: 60,
      error: null,
      createdAt: "2026-05-19T00:02:00.000Z",
    },
    steps: [],
    interventions: [],
    deliverables: [
      {
        id: "deliverable-1",
        executionId: "exec-1",
        routineId: routine.id,
        fileName: "report.pdf",
        fileSize: 1024,
        mimeType: "application/pdf",
        fileUrl: "https://files.test/report.pdf",
        createdAt: "2026-05-19T00:03:00.000Z",
      },
    ],
  },
};

describe("tasksApi", () => {
  beforeEach(() => {
    mockHttp.get.mockReset();
    mockHttp.post.mockReset();
    mockHttp.patch.mockReset();
    mockHttp.delete.mockReset();
  });

  it("uses the native task endpoint when it is available", async () => {
    const task = { id: "task-1", title: "Native task" } as TaskRun;
    mockHttp.post.mockResolvedValueOnce({ data: task });

    const dto = { title: "Native task", description: "Use task API" };
    const result = await tasksApi.create(dto);

    expect(mockHttp.post).toHaveBeenCalledWith("/v1/tasks", dto);
    expect(mockHttp.post).toHaveBeenCalledTimes(1);
    expect(result).toEqual(task);
  });

  it("falls back to routine creation when the task route is not deployed", async () => {
    mockHttp.post
      .mockRejectedValueOnce(taskRouteNotFound("POST"))
      .mockResolvedValueOnce({ data: routine });

    const result = await tasksApi.create({
      title: "找 20 位 KOC",
      description: "整理首轮触达建议",
      botId: "bot-1",
    });

    expect(mockHttp.post).toHaveBeenNthCalledWith(1, "/v1/tasks", {
      title: "找 20 位 KOC",
      description: "整理首轮触达建议",
      botId: "bot-1",
    });
    expect(mockHttp.post).toHaveBeenNthCalledWith(2, "/v1/routines", {
      title: "找 20 位 KOC",
      description: "整理首轮触达建议",
      botId: "bot-1",
      scheduleType: "once",
      status: "upcoming",
    });
    expect(result).toMatchObject({
      id: "routine-1",
      routineId: "routine-1",
      title: "找 20 位 KOC",
      status: "upcoming",
      tokenUsage: 88,
    });
  });

  it("starts the routine fallback immediately when requested", async () => {
    mockHttp.post
      .mockRejectedValueOnce(taskRouteNotFound("POST"))
      .mockResolvedValueOnce({ data: routine })
      .mockResolvedValueOnce({ data: { success: true } });

    await tasksApi.create({
      title: "找 20 位 KOC",
      description: "整理首轮触达建议",
      botId: "bot-1",
      executeImmediately: true,
    });

    expect(mockHttp.post).toHaveBeenNthCalledWith(
      3,
      "/v1/routines/routine-1/start",
      {
        message: "整理首轮触达建议",
      },
    );
  });

  it("creates the routine fallback as a draft for create-only task triggers", async () => {
    mockHttp.post
      .mockRejectedValueOnce(taskRouteNotFound("POST"))
      .mockResolvedValueOnce({
        data: { ...routine, status: "draft" },
      });

    await tasksApi.create({
      title: "整理候选达人列表",
      description: "先保存任务",
      botId: "bot-1",
      executeImmediately: false,
      triggerMode: "create_only",
    });

    expect(mockHttp.post).toHaveBeenNthCalledWith(2, "/v1/routines", {
      title: "整理候选达人列表",
      description: "先保存任务",
      botId: "bot-1",
      scheduleType: "once",
      status: "draft",
    });
    expect(mockHttp.post).toHaveBeenCalledTimes(2);
  });

  it("starts native task runs and falls back to routine start when needed", async () => {
    mockHttp.post
      .mockRejectedValueOnce(
        taskRouteNotFound("POST", "/api/v1/tasks/routine-1/start"),
      )
      .mockResolvedValueOnce({ data: { success: true } });

    await tasksApi.start("routine-1", { message: "本次执行信息" });

    expect(mockHttp.post).toHaveBeenNthCalledWith(
      1,
      "/v1/tasks/routine-1/start",
      {
        message: "本次执行信息",
      },
    );
    expect(mockHttp.post).toHaveBeenNthCalledWith(
      2,
      "/v1/routines/routine-1/start",
      {
        message: "本次执行信息",
      },
    );
  });

  it("falls back to routine list when the task list route is not deployed", async () => {
    mockHttp.get
      .mockRejectedValueOnce(taskRouteNotFound("GET"))
      .mockResolvedValueOnce({ data: [routine] });

    const result = await tasksApi.list();

    expect(mockHttp.get).toHaveBeenNthCalledWith(1, "/v1/tasks");
    expect(mockHttp.get).toHaveBeenNthCalledWith(2, "/v1/routines");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "routine-1",
      routineId: "routine-1",
      status: "upcoming",
    });
  });

  it("falls back to routine detail when the task detail route is not deployed", async () => {
    mockHttp.get
      .mockRejectedValueOnce(
        taskRouteNotFound("GET", "/api/v1/tasks/routine-1"),
      )
      .mockResolvedValueOnce({ data: routineDetail });

    const result = await tasksApi.getById("routine-1");

    expect(mockHttp.get).toHaveBeenNthCalledWith(1, "/v1/tasks/routine-1");
    expect(mockHttp.get).toHaveBeenNthCalledWith(2, "/v1/routines/routine-1");
    expect(result).toMatchObject({
      id: "routine-1",
      channelId: "channel-1",
      taskcastTaskId: "taskcast-1",
      tokenUsage: 99,
      deliverables: [
        {
          id: "deliverable-1",
          runId: "exec-1",
          routineId: "routine-1",
        },
      ],
    });
  });

  it("falls back to routine detail when the native task endpoint has no migrated run yet", async () => {
    const missingTaskRun = new Error(
      "Request failed with status 404",
    ) as Error & {
      status: number;
      response: { status: number; data: { message: string } };
    };
    missingTaskRun.status = 404;
    missingTaskRun.response = {
      status: 404,
      data: { message: "Task run not found" },
    };
    mockHttp.get
      .mockRejectedValueOnce(missingTaskRun)
      .mockResolvedValueOnce({ data: routineDetail });

    const result = await tasksApi.getById("routine-1");

    expect(mockHttp.get).toHaveBeenNthCalledWith(1, "/v1/tasks/routine-1");
    expect(mockHttp.get).toHaveBeenNthCalledWith(2, "/v1/routines/routine-1");
    expect(result).toMatchObject({
      id: "routine-1",
      routineId: "routine-1",
      channelId: "channel-1",
    });
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

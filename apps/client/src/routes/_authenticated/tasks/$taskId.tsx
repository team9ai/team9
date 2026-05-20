import { useEffect, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, PanelRightClose, PanelRightOpen, Play } from "lucide-react";
import { ChannelView } from "@/components/channel/ChannelView";
import { HomeMainContent } from "@/components/layout/contents/HomeMainContent";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { tasksApi } from "@/services/api/tasks";
import type { TaskRunDetail, TaskRunStatus } from "@/types/task";

export const Route = createFileRoute("/_authenticated/tasks/$taskId")({
  component: TaskDetailPage,
});

const STATUS_LABELS: Record<TaskRunStatus, string> = {
  draft: "待执行",
  upcoming: "待执行",
  in_progress: "进行中",
  paused: "已暂停",
  pending_action: "待处理",
  completed: "执行完毕",
  failed: "失败",
  stopped: "已停止",
  timeout: "已超时",
};

const READ_ONLY_STATUSES: TaskRunStatus[] = [
  "completed",
  "failed",
  "stopped",
  "timeout",
];

function TaskDetailPage() {
  const { taskId } = Route.useParams();

  if (taskId === "new-task") {
    return <HomeMainContent mode="task" />;
  }

  return <TaskRunDetailPage taskId={taskId} />;
}

function TaskRunDetailPage({ taskId }: { taskId: string }) {
  const {
    data: task,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => tasksApi.getById(taskId),
    refetchInterval: (query) => (query.state.error ? false : 5000),
    retry: 0,
  });
  const [isAgentSessionPanelOpen, setIsAgentSessionPanelOpen] = useState(false);
  const channelId = task?.channelId ?? null;

  useEffect(() => {
    setIsAgentSessionPanelOpen(false);
  }, [channelId, taskId]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!task) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-background text-sm text-muted-foreground">
        <p>{isError ? "任务加载失败，请稍后重试。" : "未找到任务"}</p>
        <Link to="/tasks" className="text-primary hover:underline">
          返回任务
        </Link>
      </div>
    );
  }

  const readOnly = READ_ONLY_STATUSES.includes(task.status);
  const sessionPanelLabel = isAgentSessionPanelOpen
    ? "关闭 Session 面板"
    : "打开 Session 面板";

  return (
    <div
      data-testid="task-detail-main"
      className="flex h-full min-w-0 flex-col bg-background text-foreground"
    >
      <section className="flex min-h-0 flex-1 flex-col">
        <header className="flex h-20 shrink-0 items-start justify-between border-b border-border bg-background px-6 py-4">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2">
              <h1 className="truncate text-lg font-semibold">{task.title}</h1>
              <Badge
                variant="outline"
                className="shrink-0 border-blue-200 bg-blue-50 text-blue-700"
              >
                {STATUS_LABELS[task.status]}
              </Badge>
            </div>
            <p className="line-clamp-1 text-sm text-muted-foreground">
              任务目标：
              {task.description ?? "等待补充任务目标、上下文和交付要求。"}
            </p>
          </div>
          <Button
            variant={isAgentSessionPanelOpen ? "secondary" : "ghost"}
            size="icon"
            aria-label={sessionPanelLabel}
            aria-pressed={isAgentSessionPanelOpen}
            title={sessionPanelLabel}
            onClick={() => setIsAgentSessionPanelOpen((open) => !open)}
          >
            {isAgentSessionPanelOpen ? (
              <PanelRightClose size={18} />
            ) : (
              <PanelRightOpen size={18} />
            )}
          </Button>
        </header>

        <div className="min-h-0 flex-1">
          {channelId ? (
            <ChannelView
              key={channelId}
              channelId={channelId}
              hideHeader
              readOnly={readOnly}
              isAgentSessionPanelOpen={isAgentSessionPanelOpen}
              onAgentSessionPanelOpenChange={setIsAgentSessionPanelOpen}
            />
          ) : readOnly ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              暂无执行频道
            </div>
          ) : (
            <TaskExecutionStartPanel task={task} />
          )}
        </div>
      </section>
    </div>
  );
}

function TaskExecutionStartPanel({ task }: { task: TaskRunDetail }) {
  const queryClient = useQueryClient();
  const defaultExecutionInfo = task.description?.trim() || task.title;
  const [executionInfo, setExecutionInfo] = useState(defaultExecutionInfo);
  const startTask = useMutation({
    mutationFn: () =>
      tasksApi.start(task.id, {
        message: executionInfo.trim() || task.title,
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["task", task.id] }),
        queryClient.invalidateQueries({ queryKey: ["tasks"] }),
      ]);
    },
  });

  useEffect(() => {
    setExecutionInfo(defaultExecutionInfo);
  }, [defaultExecutionInfo, task.id]);

  return (
    <div className="flex h-full items-center justify-center px-8">
      <div className="flex w-full max-w-2xl flex-col gap-4">
        <label
          htmlFor="task-execution-info"
          className="text-sm font-medium text-muted-foreground"
        >
          本次执行信息
        </label>
        <Textarea
          id="task-execution-info"
          value={executionInfo}
          onChange={(event) => setExecutionInfo(event.target.value)}
          rows={5}
          className="min-h-32 resize-none rounded-2xl border-[#ded4c8] bg-background px-4 py-3 text-sm leading-6 text-foreground shadow-none focus-visible:ring-[#b58c6a]/25"
        />
        <div className="flex justify-center">
          <Button
            type="button"
            onClick={() => startTask.mutate()}
            disabled={startTask.isPending}
            className="h-10 rounded-full bg-[#3d2413] px-5 text-sm font-medium text-white hover:bg-[#4a2d18]"
          >
            {startTask.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Play className="size-4" />
            )}
            开始执行
          </Button>
        </div>
        {startTask.isError ? (
          <p className="text-center text-sm text-destructive">
            启动失败，请稍后重试。
          </p>
        ) : null}
      </div>
    </div>
  );
}

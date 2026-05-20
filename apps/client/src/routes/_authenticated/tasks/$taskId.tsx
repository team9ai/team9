import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Loader2, PanelRightClose } from "lucide-react";
import { ChannelView } from "@/components/channel/ChannelView";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { tasksApi } from "@/services/api/tasks";
import type { TaskRunStatus } from "@/types/task";

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

  const channelId = task.channelId;
  const readOnly = READ_ONLY_STATUSES.includes(task.status);

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
          <Button variant="ghost" size="icon" aria-label="收起任务面板">
            <PanelRightClose size={18} />
          </Button>
        </header>

        <div className="min-h-0 flex-1">
          {channelId ? (
            <ChannelView
              key={channelId}
              channelId={channelId}
              hideHeader
              readOnly={readOnly}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              暂无执行频道
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

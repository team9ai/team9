import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Loader2, PanelRightClose } from "lucide-react";
import { ChannelView } from "@/components/channel/ChannelView";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { routinesApi } from "@/services/api/routines";
import { cn } from "@/lib/utils";
import type { Routine, RoutineStatus } from "@/types/routine";

export const Route = createFileRoute("/_authenticated/tasks/$taskId")({
  component: TaskDetailPage,
});

const STATUS_LABELS: Record<RoutineStatus, string> = {
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

const READ_ONLY_STATUSES: RoutineStatus[] = [
  "completed",
  "failed",
  "stopped",
  "timeout",
];

function TaskDetailPage() {
  const { taskId } = Route.useParams();
  const navigate = useNavigate();

  const {
    data: task,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => routinesApi.getById(taskId),
    refetchInterval: (query) => (query.state.error ? false : 5000),
    retry: 0,
  });

  const { data: tasks = [] } = useQuery({
    queryKey: ["tasks", "routine-backed"],
    queryFn: () => routinesApi.list(),
  });

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-[#fbf6ee]">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!task) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-[#fbf6ee] text-sm text-muted-foreground">
        <p>{isError ? "任务加载失败，请稍后重试。" : "未找到任务"}</p>
        <Link to="/tasks" className="text-primary hover:underline">
          返回任务
        </Link>
      </div>
    );
  }

  const channelId =
    task.status === "draft"
      ? task.creationChannelId
      : (task.currentExecution?.execution.channelId ?? null);
  const readOnly = READ_ONLY_STATUSES.includes(task.status);

  return (
    <div className="flex h-full min-w-0 bg-[#fbf6ee] text-[#2f261e]">
      <TaskListSidebar
        tasks={tasks}
        activeTaskId={task.id}
        onOpenTask={(id) =>
          void navigate({ to: "/tasks/$taskId", params: { taskId: id } })
        }
      />

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-24 shrink-0 items-start justify-between border-b border-[#e1d3c2] px-6 py-5">
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
            <p className="line-clamp-1 text-sm text-[#7f6e5a]">
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

function TaskListSidebar({
  tasks,
  activeTaskId,
  onOpenTask,
}: {
  tasks: Routine[];
  activeTaskId: string;
  onOpenTask: (id: string) => void;
}) {
  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-[#e1d3c2] bg-white/70">
      <div className="border-b border-[#e1d3c2] px-4 py-4">
        <Link to="/tasks" className="text-sm font-semibold hover:underline">
          任务
        </Link>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="space-y-1">
          {tasks.map((task) => (
            <button
              key={task.id}
              type="button"
              onClick={() => onOpenTask(task.id)}
              className={cn(
                "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-[#6f5f4d] hover:bg-[#efe7dc]",
                activeTaskId === task.id &&
                  "bg-[#e9dfd4] font-semibold text-[#2f261e]",
              )}
            >
              <span className="truncate">{task.title}</span>
              {task.currentExecutionId && (
                <ChevronRight className="size-4 shrink-0 text-blue-500" />
              )}
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}

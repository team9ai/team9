import {
  Link,
  useLocation,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CirclePlus, Loader2, MessageSquarePlus, Plus } from "lucide-react";
import { useMemo } from "react";
import { Separator } from "@/components/ui/separator";
import { tasksApi } from "@/services/api/tasks";
import { cn } from "@/lib/utils";
import { appActions } from "@/stores";
import type { TaskRun, TaskRunStatus } from "@/types/task";

const STATUS_LABELS: Record<TaskRunStatus, string> = {
  draft: "待执行",
  upcoming: "待执行",
  in_progress: "进行中",
  paused: "已暂停",
  pending_action: "待处理",
  completed: "查收结果",
  failed: "已归档",
  stopped: "已归档",
  timeout: "已归档",
};

const TASK_NEW_CONVERSATION_PATH = "/tasks/new-conversation";
const TASK_SIDEBAR_ACTION_CLASS =
  "flex w-full min-w-0 max-w-full items-center gap-2 overflow-hidden rounded-md px-2 py-2 text-sm font-medium text-nav-foreground-muted transition-colors hover:bg-nav-hover hover:text-nav-foreground";

export const TASK_SIDEBAR_MAX_VISIBLE_TASKS = 80;

function getTaskGroupLabel(task: TaskRun) {
  return task.routineId ? "@ 日常" : "@ 自己";
}

function getStatusClass(status: TaskRunStatus) {
  if (status === "completed") {
    return "bg-blue-500 text-white";
  }
  if (status === "pending_action") {
    return "bg-blue-50 text-blue-700";
  }
  if (status === "failed" || status === "stopped" || status === "timeout") {
    return "bg-nav-hover text-nav-foreground-faint";
  }
  return "bg-blue-50 text-blue-700";
}

function getTaskSidebarActionClass(isSelected: boolean) {
  return cn(
    TASK_SIDEBAR_ACTION_CLASS,
    isSelected && "bg-nav-active text-nav-foreground",
  );
}

export function TasksSubSidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const params = useParams({ strict: false }) as { taskId?: string };
  const selectedTaskId = params.taskId;
  const isNewConversationSelected =
    location.pathname === TASK_NEW_CONVERSATION_PATH;
  const isTaskBoardSelected =
    location.pathname === "/tasks" || location.pathname === "/tasks/";

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["tasks"],
    queryFn: () => tasksApi.list(),
  });

  const visibleTasks = useMemo(
    () => tasks.slice(0, TASK_SIDEBAR_MAX_VISIBLE_TASKS),
    [tasks],
  );
  const hiddenTaskCount = Math.max(0, tasks.length - visibleTasks.length);

  const createTask = useMutation({
    mutationFn: () =>
      tasksApi.create({
        title: "新任务",
        description: "等待补充任务目标、上下文和交付要求。",
      }),
    onSuccess: async (task) => {
      await queryClient.invalidateQueries({ queryKey: ["tasks"] });
      void navigate({
        to: "/tasks/$taskId",
        params: { taskId: task.id },
      });
    },
  });

  const groupedTasks = useMemo(() => {
    const groups = new Map<string, TaskRun[]>();

    for (const task of visibleTasks) {
      const label = getTaskGroupLabel(task);
      groups.set(label, [...(groups.get(label) ?? []), task]);
    }

    return Array.from(groups.entries()).map(([label, groupTasks]) => ({
      label,
      tasks: groupTasks,
    }));
  }, [visibleTasks]);

  const openNewConversation = () => {
    appActions.setActiveSidebar("tasks");
    void navigate({ to: TASK_NEW_CONVERSATION_PATH });
  };

  return (
    <aside
      data-testid="tasks-sub-sidebar"
      className="flex h-full w-64 min-w-0 flex-col overflow-hidden bg-nav-sub-bg text-primary-foreground"
    >
      <div className="p-4 pb-2">
        <div className="px-2 py-1.5 text-lg font-semibold text-nav-foreground">
          任务
        </div>
      </div>

      <Separator className="bg-nav-border" />

      <div
        data-testid="tasks-sub-sidebar-scroll"
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3"
      >
        <nav className="min-w-0 space-y-0.5 pb-3 pt-2">
          <div className="mb-2 border-b border-nav-border pb-2">
            <button
              type="button"
              onClick={openNewConversation}
              className={getTaskSidebarActionClass(isNewConversationSelected)}
            >
              <Plus className="size-4" />
              新对话
            </button>
            <button
              type="button"
              disabled={createTask.isPending}
              onClick={() => createTask.mutate()}
              className={getTaskSidebarActionClass(false)}
            >
              {createTask.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CirclePlus className="size-4" />
              )}
              新任务
            </button>
            <Link
              to="/tasks"
              className={getTaskSidebarActionClass(isTaskBoardSelected)}
            >
              <MessageSquarePlus className="size-4" />
              任务看板
            </Link>
          </div>

          <div className="px-2 py-1 text-[0.7rem] font-semibold uppercase tracking-wide text-nav-foreground-faint">
            任务
          </div>

          {isLoading ? (
            <p className="px-2 py-2 text-xs text-nav-foreground-faint">
              <Loader2 className="mr-2 inline size-3.5 animate-spin" />
              加载中
            </p>
          ) : groupedTasks.length === 0 ? (
            <p className="px-2 py-2 text-xs text-nav-foreground-faint">
              暂无任务
            </p>
          ) : (
            groupedTasks.map((group) => (
              <div key={group.label} className="min-w-0 pb-2">
                <div className="truncate px-2 py-1 text-sm font-medium text-nav-foreground-muted">
                  {group.label}
                </div>
                <div className="min-w-0 space-y-px">
                  {group.tasks.map((task) => (
                    <Link
                      key={task.id}
                      to="/tasks/$taskId"
                      params={{ taskId: task.id }}
                      data-testid="task-sidebar-row"
                      className={cn(
                        "flex w-full min-w-0 max-w-full items-center gap-2 overflow-hidden rounded-md px-2 py-2 text-sm font-medium text-nav-foreground-muted transition-colors hover:bg-nav-hover hover:text-nav-foreground",
                        selectedTaskId === task.id &&
                          "bg-nav-active text-nav-foreground",
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {task.title}
                      </span>
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-2 py-0.5 text-[0.68rem] font-semibold",
                          getStatusClass(task.status),
                        )}
                      >
                        {STATUS_LABELS[task.status]}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            ))
          )}
          {hiddenTaskCount > 0 ? (
            <p className="px-2 py-2 text-xs text-nav-foreground-faint">
              还有 {hiddenTaskCount} 个任务，可在任务看板查看。
            </p>
          ) : null}
        </nav>
      </div>
    </aside>
  );
}

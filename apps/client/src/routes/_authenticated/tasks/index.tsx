import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Filter,
  ListFilter,
  Loader2,
  MoreHorizontal,
  Plus,
} from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { tasksApi } from "@/services/api/tasks";
import { cn } from "@/lib/utils";
import type { TaskRun, TaskRunStatus } from "@/types/task";

export const Route = createFileRoute("/_authenticated/tasks/")({
  component: TasksPage,
});

type TaskColumnKey = "pending" | "running" | "completed" | "archived";
type TaskBoardItem = { task: TaskRun; code: string };

interface TaskColumnConfig {
  key: TaskColumnKey;
  title: string;
  statuses: TaskRunStatus[];
  dotClass: string;
}

const TASK_COLUMNS: TaskColumnConfig[] = [
  {
    key: "pending",
    title: "待执行",
    statuses: ["draft", "upcoming"],
    dotClass: "border-muted-foreground",
  },
  {
    key: "running",
    title: "执行中",
    statuses: ["in_progress", "paused", "pending_action"],
    dotClass: "border-blue-500 text-blue-500",
  },
  {
    key: "completed",
    title: "执行完毕",
    statuses: ["completed"],
    dotClass: "border-sky-600 text-sky-600",
  },
  {
    key: "archived",
    title: "归档",
    statuses: ["failed", "stopped", "timeout"],
    dotClass: "border-muted-foreground text-muted-foreground",
  },
];

const TASK_COLUMN_BY_STATUS = new Map<TaskRunStatus, TaskColumnKey>(
  TASK_COLUMNS.flatMap((column) =>
    column.statuses.map((status) => [status, column.key] as const),
  ),
);

function TasksPage() {
  const { t } = useTranslation("navigation");
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["tasks"],
    queryFn: () => tasksApi.list(),
  });

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

  const indexedTasks = useMemo(
    () =>
      tasks.map((task, index) => ({
        task,
        code: `T9-${String(index + 1).padStart(2, "0")}`,
      })),
    [tasks],
  );

  const grouped = useMemo(() => {
    const initial: Record<TaskColumnKey, TaskBoardItem[]> = {
      pending: [],
      running: [],
      completed: [],
      archived: [],
    };

    for (const item of indexedTasks) {
      const key = TASK_COLUMN_BY_STATUS.get(item.task.status) ?? "pending";
      initial[key].push(item);
    }

    return initial;
  }, [indexedTasks]);

  const openTask = (task: TaskRun) => {
    void navigate({
      to: "/tasks/$taskId",
      params: { taskId: task.id },
    });
  };

  return (
    <div
      data-testid="tasks-board-page"
      className="flex h-full min-w-0 flex-col bg-background text-foreground"
    >
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-background px-6">
        <div className="flex items-center gap-3">
          <button className="flex h-10 items-center gap-3 rounded-lg border border-border bg-card px-4 text-sm text-muted-foreground transition-colors hover:bg-accent/40">
            <span>任务用户</span>
            <span className="font-semibold text-foreground">自己</span>
          </button>
          <button className="flex h-10 items-center gap-3 rounded-lg border border-border bg-card px-4 text-sm text-muted-foreground transition-colors hover:bg-accent/40">
            <span>Agent</span>
            <span className="font-semibold text-foreground">全部</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" aria-label="筛选任务">
            <Filter size={17} />
          </Button>
          <Button variant="outline" size="icon" aria-label="任务排序">
            <ListFilter size={17} />
          </Button>
          <Button
            className="bg-nav-foreground text-nav-sub-bg hover:bg-nav-foreground-strong"
            disabled={createTask.isPending}
            onClick={() => createTask.mutate()}
          >
            {createTask.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus size={17} />
            )}
            新增任务
          </Button>
        </div>
      </header>

      <main
        data-testid="tasks-board-main"
        className="min-h-0 flex-1 overflow-x-auto bg-background p-6"
      >
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid min-h-full min-w-[980px] grid-cols-4 gap-6">
            {TASK_COLUMNS.map((column) => (
              <TaskColumn
                key={column.key}
                column={column}
                items={grouped[column.key]}
                onOpenTask={openTask}
              />
            ))}
          </div>
        )}
      </main>

      <span className="sr-only">{t("tasks", "Tasks")}</span>
    </div>
  );
}

function TaskColumn({
  column,
  items,
  onOpenTask,
}: {
  column: TaskColumnConfig;
  items: TaskBoardItem[];
  onOpenTask: (task: TaskRun) => void;
}) {
  return (
    <section
      data-testid={`task-column-${column.key}`}
      className={cn(
        "min-h-full rounded-lg border border-border/60 bg-muted/25 px-4 py-4",
        column.key === "running" && "bg-accent/35",
      )}
    >
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <span
            className={cn(
              "inline-flex size-4 items-center justify-center rounded-full border-2",
              column.dotClass,
            )}
          />
          <span>{column.title}</span>
          <span className="text-muted-foreground">{items.length}</span>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`${column.title}更多`}
        >
          <MoreHorizontal size={16} />
        </Button>
      </div>

      <div className="space-y-3">
        {items.map(({ task, code }) => (
          <TaskCard
            key={task.id}
            task={task}
            code={code}
            onClick={() => onOpenTask(task)}
          />
        ))}
      </div>
    </section>
  );
}

function TaskCard({
  task,
  code,
  onClick,
}: {
  task: TaskRun;
  code: string;
  onClick: () => void;
}) {
  const agentLabel = task.botId ? "@Agent" : "@自己";

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-lg border border-border bg-card p-4 text-left shadow-sm transition hover:bg-accent/40 hover:shadow-md"
    >
      <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
        <span>{code}</span>
        <MoreHorizontal size={16} />
      </div>
      <h3 className="line-clamp-2 text-[15px] font-semibold leading-6 text-card-foreground">
        {task.title}
      </h3>
      <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">
        <span className="font-medium text-blue-600">{agentLabel}</span>{" "}
        {task.description ?? "等待补充任务目标、上下文和交付要求。"}
      </p>
      <p className="mt-4 text-sm text-muted-foreground">自己</p>
    </button>
  );
}

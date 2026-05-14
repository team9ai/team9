import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Filter,
  ListFilter,
  Loader2,
  MoreHorizontal,
  Plus,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { AgenticAgentPicker } from "@/components/routines/AgenticAgentPicker";
import { CreateRoutineDialog } from "@/components/routines/CreateRoutineDialog";
import { routinesApi } from "@/services/api/routines";
import { cn } from "@/lib/utils";
import type { Routine, RoutineStatus } from "@/types/routine";

export const Route = createFileRoute("/_authenticated/tasks/")({
  component: TasksPage,
});

type TaskColumnKey = "pending" | "running" | "completed" | "archived";
type TaskBoardItem = { routine: Routine; code: string };

interface TaskColumnConfig {
  key: TaskColumnKey;
  title: string;
  statuses: RoutineStatus[];
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

const TASK_COLUMN_BY_STATUS = new Map<RoutineStatus, TaskColumnKey>(
  TASK_COLUMNS.flatMap((column) =>
    column.statuses.map((status) => [status, column.key] as const),
  ),
);

function TasksPage() {
  const { t } = useTranslation("navigation");
  const navigate = useNavigate();
  const [agenticPickerOpen, setAgenticPickerOpen] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  const { data: routines = [], isLoading } = useQuery({
    queryKey: ["tasks", "routine-backed"],
    queryFn: () => routinesApi.list(),
  });

  const indexedRoutines = useMemo(
    () =>
      routines.map((routine, index) => ({
        routine,
        code: `T9-${String(index + 1).padStart(2, "0")}`,
      })),
    [routines],
  );

  const grouped = useMemo(() => {
    const initial: Record<TaskColumnKey, TaskBoardItem[]> = {
      pending: [],
      running: [],
      completed: [],
      archived: [],
    };

    for (const item of indexedRoutines) {
      const key = TASK_COLUMN_BY_STATUS.get(item.routine.status) ?? "pending";
      initial[key].push(item);
    }

    return initial;
  }, [indexedRoutines]);

  const openTask = (routine: Routine) => {
    if (routine.currentExecutionId) {
      void navigate({
        to: "/routines/$routineId/runs/$executionId",
        params: {
          routineId: routine.id,
          executionId: routine.currentExecutionId,
        },
      });
      return;
    }

    if (routine.status === "draft" && routine.creationChannelId) {
      void navigate({
        to: "/routines/$routineId/runs/$executionId",
        params: { routineId: routine.id, executionId: "creation" },
      });
      return;
    }

    void navigate({
      to: "/routines/$routineId",
      params: { routineId: routine.id },
    });
  };

  return (
    <div className="flex h-full min-w-0 flex-col bg-[#f7f1e8] text-[#2f261e]">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-[#d8c9b5] bg-[#fbf6ee] px-6">
        <div className="flex items-center gap-3">
          <button className="flex h-10 items-center gap-3 rounded-lg border border-[#d5c4ad] bg-[#fffaf3] px-4 text-sm text-[#725f49]">
            <span>任务用户</span>
            <span className="font-semibold text-[#2f261e]">自己</span>
          </button>
          <button className="flex h-10 items-center gap-3 rounded-lg border border-[#d5c4ad] bg-[#fffaf3] px-4 text-sm text-[#725f49]">
            <span>Agent</span>
            <span className="font-semibold text-[#2f261e]">全部</span>
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
            className="bg-[#583411] text-white hover:bg-[#6a421a]"
            onClick={() => setAgenticPickerOpen(true)}
          >
            <Plus size={17} />
            新增任务
          </Button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-x-auto p-6">
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid h-full min-w-[980px] grid-cols-4 gap-6">
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

      <CreateRoutineDialog
        isOpen={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
      />
      <AgenticAgentPicker
        open={agenticPickerOpen}
        onClose={() => setAgenticPickerOpen(false)}
        onManualCreate={() => {
          setAgenticPickerOpen(false);
          setShowCreateDialog(true);
        }}
        onOpenCreationSession={(id) =>
          void navigate({
            to: "/routines/$routineId/runs/$executionId",
            params: { routineId: id, executionId: "creation" },
          })
        }
      />

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
  onOpenTask: (routine: Routine) => void;
}) {
  return (
    <section
      data-testid={`task-column-${column.key}`}
      className={cn(
        "min-h-0 rounded-lg bg-white/60 px-4 py-4",
        column.key === "running" && "bg-slate-100/80",
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
        {items.map(({ routine, code }) => (
          <TaskCard
            key={routine.id}
            routine={routine}
            code={code}
            onClick={() => onOpenTask(routine)}
          />
        ))}
      </div>
    </section>
  );
}

function TaskCard({
  routine,
  code,
  onClick,
}: {
  routine: Routine;
  code: string;
  onClick: () => void;
}) {
  const agentLabel = routine.botId ? "@Agent" : "@Agent";

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-lg border border-[#dfd1bf] bg-[#fffaf5] p-4 text-left shadow-sm transition hover:border-[#c5ad91] hover:shadow-md"
    >
      <div className="mb-3 flex items-center justify-between text-xs text-[#7f6e5a]">
        <span>{code}</span>
        <MoreHorizontal size={16} />
      </div>
      <h3 className="line-clamp-2 text-[15px] font-semibold leading-6 text-[#2f261e]">
        {routine.title}
      </h3>
      <p className="mt-2 line-clamp-2 text-sm leading-6 text-[#7f6e5a]">
        <span className="font-medium text-blue-600">{agentLabel}</span>{" "}
        {routine.description ?? "等待补充任务目标、上下文和交付要求。"}
      </p>
      <p className="mt-4 text-sm text-[#7f6e5a]">自己</p>
    </button>
  );
}

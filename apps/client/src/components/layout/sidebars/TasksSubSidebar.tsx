import {
  Link,
  useLocation,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  CirclePlus,
  EyeOff,
  Loader2,
  MessageSquarePlus,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Separator } from "@/components/ui/separator";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { AgentGroupList } from "@/components/sidebar/AgentGroupList";
import { useAgentGroupsForSidebar } from "@/hooks/useAgentGroupsForSidebar";
import {
  useDeleteTopicSession,
  useRenameTopicSession,
} from "@/hooks/useTopicSessions";
import { tasksApi } from "@/services/api/tasks";
import { cn } from "@/lib/utils";
import {
  appActions,
  HOME_ENTRY_PATH,
  homeActions,
  useDashboardMode,
} from "@/stores";
import {
  getDashboardModeEntryPath,
  isDashboardModeEntryPath,
  replaceDashboardModeEntryUrl,
} from "@/lib/dashboard-mode";
import type { TaskRun, TaskRunStatus } from "@/types/task";

const RENAME_TASK_ERROR_MESSAGE = "保存失败，请稍后重试。";

const STATUS_LABELS: Record<TaskRunStatus, string> = {
  draft: "待执行",
  upcoming: "待执行",
  in_progress: "进行中",
  paused: "已暂停",
  pending_action: "待处理",
  completed: "查收结果",
  failed: "失败",
  stopped: "已停止",
  timeout: "已超时",
};

const TASK_SIDEBAR_ACTION_CLASS =
  "flex w-full min-w-0 max-w-full items-center gap-2 overflow-hidden rounded-md px-2 py-2 text-sm font-medium text-nav-foreground-muted transition-colors hover:bg-nav-hover hover:text-nav-foreground";

type DashboardSidebarMode = "conversation" | "task";

export const TASK_SIDEBAR_MAX_VISIBLE_TASKS = 80;
const TASK_SIDEBAR_VISIBLE_STATUSES = new Set<TaskRunStatus>([
  "in_progress",
  "paused",
  "pending_action",
  "completed",
  "failed",
  "stopped",
  "timeout",
]);

function getTaskGroupLabel(task: TaskRun) {
  return task.routineId ? "@ 日常" : "我的任务";
}

function getStatusClass(status: TaskRunStatus) {
  if (status === "completed") {
    return "bg-blue-500 text-white";
  }
  if (status === "pending_action") {
    return "bg-blue-50 text-blue-700";
  }
  if (status === "failed" || status === "timeout") {
    return "bg-red-50 text-red-700";
  }
  if (status === "stopped") {
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

function isVisibleSidebarTask(task: TaskRun) {
  return (
    TASK_SIDEBAR_VISIBLE_STATUSES.has(task.status) &&
    !task.hiddenAt &&
    !task.archivedAt
  );
}

function getDashboardSidebarMode(pathname: string): DashboardSidebarMode {
  return pathname === HOME_ENTRY_PATH ? "conversation" : "task";
}

export function TasksSubSidebar() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const location = useLocation();
  const params = useParams({ strict: false }) as { taskId?: string };
  const dashboardMode = useDashboardMode();
  const [renamingTask, setRenamingTask] = useState<TaskRun | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const selectedTaskId = params.taskId;
  const activeMode = dashboardMode;
  const isConversationMode = activeMode === "conversation";
  const isTaskMode = activeMode === "task";
  const isDashboardEntrySelected = isDashboardModeEntryPath(location.pathname);
  const isNewConversationSelected =
    isConversationMode && isDashboardEntrySelected;
  const isNewTaskSelected = isTaskMode && isDashboardEntrySelected;
  const isTaskBoardSelected =
    isTaskMode &&
    (location.pathname === "/tasks" || location.pathname === "/tasks/");
  const {
    groups: agentGroups,
    isLoading: isLoadingAgents,
    loadMoreTopicSessions,
    isLoadingMoreTopicSessions,
  } = useAgentGroupsForSidebar(5);
  const renameTopicSession = useRenameTopicSession();
  const archiveTopicSession = useDeleteTopicSession();
  const deleteTopicSession = useDeleteTopicSession();

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["tasks"],
    queryFn: () => tasksApi.list(),
  });

  useEffect(() => {
    homeActions.setDashboardMode(getDashboardSidebarMode(location.pathname));
  }, [location.pathname]);

  const sidebarTasks = useMemo(
    () => tasks.filter(isVisibleSidebarTask),
    [tasks],
  );
  const visibleTasks = useMemo(
    () => sidebarTasks.slice(0, TASK_SIDEBAR_MAX_VISIBLE_TASKS),
    [sidebarTasks],
  );
  const hiddenTaskCount = Math.max(
    0,
    sidebarTasks.length - visibleTasks.length,
  );

  const refreshTaskQueries = async (taskId?: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["tasks"] }),
      taskId
        ? queryClient.invalidateQueries({ queryKey: ["task", taskId] })
        : Promise.resolve(),
    ]);
  };

  const updateTask = useMutation({
    mutationFn: ({ taskId, title }: { taskId: string; title: string }) =>
      tasksApi.update(taskId, { title }),
    onSuccess: async (updatedTask) => {
      queryClient.setQueryData<TaskRun[]>(["tasks"], (current) =>
        current?.map((task) =>
          task.id === updatedTask.id ? { ...task, ...updatedTask } : task,
        ),
      );
      await refreshTaskQueries(updatedTask.id);
    },
  });

  const hideTask = useMutation({
    mutationFn: (taskId: string) => tasksApi.hide(taskId),
    onSuccess: async (updatedTask) => {
      await refreshTaskQueries(updatedTask.id);
    },
  });

  const archiveTask = useMutation({
    mutationFn: (taskId: string) => tasksApi.archive(taskId),
    onSuccess: async (updatedTask) => {
      await refreshTaskQueries(updatedTask.id);
    },
  });

  const deleteTask = useMutation({
    mutationFn: (taskId: string) => tasksApi.delete(taskId),
    onSuccess: async (_result, taskId) => {
      await refreshTaskQueries(taskId);
      if (selectedTaskId === taskId) {
        void navigate({ to: HOME_ENTRY_PATH });
      }
    },
  });

  const openRenameDialog = (task: TaskRun) => {
    setRenamingTask(task);
    setRenameTitle(task.title);
    setRenameError(null);
  };

  const closeRenameDialog = () => {
    setRenamingTask(null);
    setRenameTitle("");
    setRenameError(null);
  };

  const submitRename = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!renamingTask) return;

    const title = renameTitle.trim();
    if (!title || title === renamingTask.title) {
      closeRenameDialog();
      return;
    }

    setRenameError(null);
    try {
      await updateTask.mutateAsync({ taskId: renamingTask.id, title });
      closeRenameDialog();
    } catch {
      setRenameError(RENAME_TASK_ERROR_MESSAGE);
    }
  };

  const requestDeleteTask = (task: TaskRun) => {
    const confirmed = window.confirm(`删除任务“${task.title}”？`);
    if (!confirmed) return;

    deleteTask.mutate(task.id);
  };

  const openTask = (task: TaskRun) => {
    void navigate({
      to: "/tasks/$taskId",
      params: { taskId: task.id },
    });
  };

  const actionHandlers = {
    onRename: openRenameDialog,
    onHide: (task: TaskRun) => hideTask.mutate(task.id),
    onArchive: (task: TaskRun) => archiveTask.mutate(task.id),
    onDelete: requestDeleteTask,
  };

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

  const openDashboardEntry = (nextMode: DashboardSidebarMode) => {
    appActions.setActiveSidebar("home");
    homeActions.setDashboardMode(nextMode);

    if (isDashboardModeEntryPath(location.pathname)) {
      replaceDashboardModeEntryUrl(nextMode);
      return;
    }

    void navigate({ to: getDashboardModeEntryPath(nextMode) });
  };

  const openNewConversation = () => {
    openDashboardEntry("conversation");
  };

  const openNewTask = () => {
    openDashboardEntry("task");
  };

  const openConversationTopic = (agentId: string) => {
    appActions.setActiveSidebar("home");
    homeActions.setDashboardMode("conversation");
    void navigate({
      to: HOME_ENTRY_PATH,
      search: { agentId },
    });
  };

  const selectConversationMode = () => {
    appActions.setActiveSidebar("home");
    homeActions.setDashboardMode("conversation");
    if (isDashboardModeEntryPath(location.pathname)) {
      replaceDashboardModeEntryUrl("conversation");
    }
  };

  const selectTaskMode = () => {
    appActions.setActiveSidebar("home");
    homeActions.setDashboardMode("task");
    if (isDashboardModeEntryPath(location.pathname)) {
      replaceDashboardModeEntryUrl("task");
    }
  };

  return (
    <aside
      data-testid="tasks-sub-sidebar"
      className="flex h-full w-64 min-w-0 flex-col overflow-hidden bg-nav-sub-bg text-primary-foreground"
    >
      <div className="p-4 pb-2">
        <div className="px-2 py-1.5 text-lg font-semibold text-nav-foreground">
          首页
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
              onClick={openNewTask}
              className={getTaskSidebarActionClass(isNewTaskSelected)}
            >
              <CirclePlus className="size-4" />
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

          <div
            role="tablist"
            aria-label="首页模式"
            className="relative mx-auto mb-2 mt-2 grid w-full max-w-36 grid-cols-2 overflow-hidden rounded-xl border border-nav-border bg-nav-hover/40 p-0.5 text-xs font-medium text-nav-foreground-muted"
          >
            <span
              aria-hidden="true"
              data-testid="dashboard-sidebar-mode-indicator"
              className={cn(
                "pointer-events-none absolute bottom-0.5 top-0.5 w-[calc(50%-0.125rem)] rounded-lg bg-nav-active transition-[left] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
                isTaskMode ? "left-1/2" : "left-0.5",
              )}
            />
            <button
              type="button"
              role="tab"
              aria-selected={isConversationMode}
              onClick={selectConversationMode}
              className={cn(
                "relative z-10 rounded-lg px-2 py-1 transition-colors duration-150 hover:text-nav-foreground",
                isConversationMode && "text-nav-foreground",
              )}
            >
              对话
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={isTaskMode}
              onClick={selectTaskMode}
              className={cn(
                "relative z-10 rounded-lg px-2 py-1 transition-colors duration-150 hover:text-nav-foreground",
                isTaskMode && "text-nav-foreground",
              )}
            >
              任务
            </button>
          </div>

          <div
            key={activeMode}
            data-testid="dashboard-sidebar-mode-content"
            className="min-w-0 animate-in fade-in-0 slide-in-from-top-1 duration-150 ease-out motion-reduce:animate-none"
          >
            {isConversationMode ? (
              <>
                <div className="px-2 py-1 text-[0.7rem] font-semibold uppercase tracking-wide text-nav-foreground-faint">
                  AI Agents
                </div>
                <AgentGroupList
                  groups={agentGroups}
                  linkPrefix="/channels"
                  isLoading={isLoadingAgents}
                  onLoadMoreTopicSessions={loadMoreTopicSessions}
                  isLoadingMoreTopicSessions={isLoadingMoreTopicSessions}
                  onRenameTopicSession={(channelId, title) =>
                    renameTopicSession.mutateAsync({ channelId, title })
                  }
                  onArchiveTopicSession={(channelId) =>
                    archiveTopicSession.mutateAsync({ channelId })
                  }
                  onDeleteTopicSession={(channelId) =>
                    deleteTopicSession.mutateAsync({
                      channelId,
                      permanent: true,
                    })
                  }
                  isTopicSessionActionPending={
                    renameTopicSession.isPending ||
                    archiveTopicSession.isPending ||
                    deleteTopicSession.isPending
                  }
                  onNewTopic={openConversationTopic}
                />
              </>
            ) : (
              <>
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
                          <TaskSidebarRow
                            key={task.id}
                            task={task}
                            isSelected={selectedTaskId === task.id}
                            onOpen={openTask}
                            actions={actionHandlers}
                          />
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
              </>
            )}
          </div>
        </nav>
      </div>

      <Dialog
        open={renamingTask !== null}
        onOpenChange={(open) => {
          if (!open) closeRenameDialog();
        }}
      >
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>重命名任务</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitRename} className="space-y-4">
            <Input
              value={renameTitle}
              onChange={(event) => {
                setRenameTitle(event.target.value);
                setRenameError(null);
              }}
              autoFocus
              maxLength={500}
              aria-label="任务标题"
            />
            {renameError ? (
              <p role="alert" className="text-sm text-destructive">
                {renameError}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={closeRenameDialog}
              >
                取消
              </Button>
              <Button
                type="submit"
                disabled={!renameTitle.trim() || updateTask.isPending}
              >
                {updateTask.isPending ? "保存中..." : "保存"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </aside>
  );
}

interface TaskActionHandlers {
  onRename: (task: TaskRun) => void;
  onHide: (task: TaskRun) => void;
  onArchive: (task: TaskRun) => void;
  onDelete: (task: TaskRun) => void;
}

function TaskSidebarRow({
  task,
  isSelected,
  onOpen,
  actions,
}: {
  task: TaskRun;
  isSelected: boolean;
  onOpen: (task: TaskRun) => void;
  actions: TaskActionHandlers;
}) {
  const open = () => onOpen(task);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          data-testid="task-sidebar-row"
          className={cn(
            "group relative flex w-full min-w-0 max-w-full items-center gap-2 overflow-hidden rounded-md px-2 py-2 text-sm font-medium text-nav-foreground-muted transition-colors hover:bg-nav-hover hover:text-nav-foreground",
            isSelected && "bg-nav-active text-nav-foreground",
          )}
        >
          <button
            type="button"
            onClick={open}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            <span className="min-w-0 flex-1 truncate">{task.title}</span>
            <span
              className={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-[0.68rem] font-semibold transition-[margin] group-hover:mr-7 group-focus-within:mr-7",
                getStatusClass(task.status),
              )}
            >
              {STATUS_LABELS[task.status]}
            </span>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`${task.title}更多操作`}
                onClick={(event) => event.stopPropagation()}
                className="absolute right-1.5 top-1/2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-md opacity-0 transition-opacity hover:bg-nav-active focus:opacity-100 focus:outline-none group-hover:opacity-100 data-[state=open]:opacity-100"
              >
                <MoreHorizontal className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-32">
              <DropdownTaskActionItems task={task} actions={actions} />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextTaskActionItems task={task} actions={actions} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function DropdownTaskActionItems({
  task,
  actions,
}: {
  task: TaskRun;
  actions: TaskActionHandlers;
}) {
  return (
    <>
      <DropdownMenuItem onSelect={() => actions.onRename(task)}>
        <Pencil className="size-4" />
        重命名
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => actions.onHide(task)}>
        <EyeOff className="size-4" />
        隐藏
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => actions.onArchive(task)}>
        <Archive className="size-4" />
        归档
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onSelect={() => actions.onDelete(task)}
        className="text-destructive focus:text-destructive"
      >
        <Trash2 className="size-4" />
        删除
      </DropdownMenuItem>
    </>
  );
}

function ContextTaskActionItems({
  task,
  actions,
}: {
  task: TaskRun;
  actions: TaskActionHandlers;
}) {
  return (
    <>
      <ContextMenuItem onSelect={() => actions.onRename(task)}>
        <Pencil className="mr-2 size-4" />
        重命名
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => actions.onHide(task)}>
        <EyeOff className="mr-2 size-4" />
        隐藏
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => actions.onArchive(task)}>
        <Archive className="mr-2 size-4" />
        归档
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem
        onSelect={() => actions.onDelete(task)}
        className="text-destructive focus:text-destructive"
      >
        <Trash2 className="mr-2 size-4" />
        删除
      </ContextMenuItem>
    </>
  );
}

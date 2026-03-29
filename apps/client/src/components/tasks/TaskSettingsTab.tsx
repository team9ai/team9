import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { tasksApi } from "@/services/api/tasks";
import { api } from "@/services/api";
import { useSelectedWorkspaceId } from "@/stores/useWorkspaceStore";
import { TaskTriggersTab } from "./TaskTriggersTab";
import { TaskDocumentTab } from "./TaskDocumentTab";
import type { AgentTaskDetail } from "@/types/task";

interface TaskSettingsTabProps {
  task: AgentTaskDetail;
  onClose: () => void;
}

export function TaskSettingsTab({ task, onClose }: TaskSettingsTabProps) {
  const { t } = useTranslation("tasks");
  const queryClient = useQueryClient();
  const workspaceId = useSelectedWorkspaceId();

  // Bot assignment mutation
  const updateBotMutation = useMutation({
    mutationFn: (botId: string | null) => tasksApi.update(task.id, { botId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["task", task.id] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: () => tasksApi.delete(task.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      onClose();
    },
  });

  // Fetch bots for assignment (all app types: openclaw + base-model-staff)
  const { data: allBots = [] } = useQuery({
    queryKey: ["installed-applications-with-bots", workspaceId],
    queryFn: async () => {
      const apps = await api.applications.getInstalledApplicationsWithBots();
      return apps.filter((a) => a.status === "active").flatMap((a) => a.bots);
    },
    enabled: !!workspaceId,
  });

  const canDelete =
    task.status === "upcoming" ||
    task.status === "completed" ||
    task.status === "failed" ||
    task.status === "stopped" ||
    task.status === "timeout";

  return (
    <div className="space-y-5">
      {/* Task info */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">{task.title}</h3>
        {task.description && (
          <p className="text-xs text-muted-foreground">{task.description}</p>
        )}
      </div>

      {/* Bot assignment */}
      <div className="space-y-1">
        <span className="text-xs text-muted-foreground">
          {t("detail.assignBot")}
        </span>
        <Select
          value={task.botId ?? "__none__"}
          onValueChange={(val) =>
            updateBotMutation.mutate(val === "__none__" ? null : val)
          }
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">
              <span className="text-muted-foreground">{t("detail.noBot")}</span>
            </SelectItem>
            {allBots.map((bot) => (
              <SelectItem key={bot.botId} value={bot.botId}>
                {bot.displayName || bot.username}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Separator />

      {/* Triggers */}
      <TaskTriggersTab taskId={task.id} />

      <Separator />

      {/* Document */}
      <TaskDocumentTab task={task} />

      {/* Delete */}
      {canDelete && (
        <>
          <Separator />
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive w-full justify-start"
            disabled={deleteMutation.isPending}
            onClick={() => {
              if (window.confirm(t("settingsTab.deleteConfirm"))) {
                deleteMutation.mutate();
              }
            }}
          >
            <Trash2 size={14} />
            {t("detail.delete")}
          </Button>
        </>
      )}
    </div>
  );
}

import { useMemo } from "react";
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
import { routinesApi } from "@/services/api/routines";
import { api } from "@/services/api";
import { useSelectedWorkspaceId } from "@/stores/useWorkspaceStore";
import { RoutineTriggersTab } from "./RoutineTriggersTab";
import { RoutineDocumentTab } from "./RoutineDocumentTab";
import type { RoutineDetail } from "@/types/routine";

interface RoutineSettingsTabProps {
  routine: RoutineDetail;
  onClose: () => void;
}

export function RoutineSettingsTab({
  routine,
  onClose,
}: RoutineSettingsTabProps) {
  const { t } = useTranslation("routines");
  const queryClient = useQueryClient();
  const workspaceId = useSelectedWorkspaceId();

  // Bot assignment mutation
  const updateBotMutation = useMutation({
    mutationFn: (botId: string | null) =>
      routinesApi.update(routine.id, { botId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["routine", routine.id] });
      queryClient.invalidateQueries({ queryKey: ["routines"] });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: () => routinesApi.delete(routine.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["routines"] });
      onClose();
    },
  });

  const { data: installedApps = [] } = useQuery({
    queryKey: ["installed-applications-with-bots", workspaceId],
    queryFn: () => api.applications.getInstalledApplicationsWithBots(),
    enabled: !!workspaceId,
  });

  const allBots = useMemo(
    () =>
      installedApps
        .filter((a) => a.status === "active")
        .flatMap((a) => a.bots)
        .filter((b) => b.botId),
    [installedApps],
  );

  const canDelete =
    routine.status === "upcoming" ||
    routine.status === "completed" ||
    routine.status === "failed" ||
    routine.status === "stopped" ||
    routine.status === "timeout";

  return (
    <div className="space-y-5">
      {/* Task info */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">{routine.title}</h3>
        {routine.description && (
          <p className="text-xs text-muted-foreground">{routine.description}</p>
        )}
      </div>

      {/* Bot assignment */}
      <div className="space-y-1">
        <span className="text-xs text-muted-foreground">
          {t("detail.assignBot")}
        </span>
        <Select
          value={routine.botId ?? "__none__"}
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
      <RoutineTriggersTab routineId={routine.id} />

      <Separator />

      {/* Document */}
      <RoutineDocumentTab routine={routine} />

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

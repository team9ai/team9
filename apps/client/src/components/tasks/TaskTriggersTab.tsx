import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Loader2,
  Hand,
  Timer,
  CalendarClock,
  MessageSquare,
  Trash2,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { tasksApi } from "@/services/api/tasks";
import type { AgentTaskTriggerType } from "@/types/task";
import { AddTriggerDialog } from "./AddTriggerDialog";

interface TaskTriggersTabProps {
  taskId: string;
}

const TRIGGER_TYPE_ICON: Record<AgentTaskTriggerType, typeof Hand> = {
  manual: Hand,
  interval: Timer,
  schedule: CalendarClock,
  channel_message: MessageSquare,
};

function formatCountdown(targetDate: string): string {
  const diff = new Date(targetDate).getTime() - Date.now();
  if (diff <= 0) return "now";
  const hours = Math.floor(diff / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60_000);
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `${days}d`;
  }
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function TaskTriggersTab({ taskId }: TaskTriggersTabProps) {
  const { t } = useTranslation("tasks");
  const queryClient = useQueryClient();
  const [showAddDialog, setShowAddDialog] = useState(false);

  const { data: triggers = [], isLoading } = useQuery({
    queryKey: ["task-triggers", taskId],
    queryFn: () => tasksApi.listTriggers(taskId),
  });

  const deleteMutation = useMutation({
    mutationFn: (triggerId: string) =>
      tasksApi.deleteTrigger(taskId, triggerId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["task-triggers", taskId] }),
  });

  const toggleMutation = useMutation({
    mutationFn: ({
      triggerId,
      enabled,
    }: {
      triggerId: string;
      enabled: boolean;
    }) => tasksApi.updateTrigger(taskId, triggerId, { enabled }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["task-triggers", taskId] }),
  });

  if (isLoading) {
    return (
      <div className="flex justify-center p-4">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {triggers.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("triggers.empty")}</p>
      )}

      {triggers.map((trigger) => {
        const Icon = TRIGGER_TYPE_ICON[trigger.type] ?? Timer;
        const config = trigger.config ?? {};

        // Build config summary inline to use typed t() directly
        let configSummary = "";
        switch (trigger.type) {
          case "manual":
            configSummary = t("triggers.types.manual");
            break;
          case "interval": {
            const value = (config.every as number) ?? 1;
            const unit = (config.unit as string) ?? "hours";
            const INTERVAL_UNIT_KEYS = {
              minutes: "triggers.interval.units.minutes",
              hours: "triggers.interval.units.hours",
              days: "triggers.interval.units.days",
              weeks: "triggers.interval.units.weeks",
              months: "triggers.interval.units.months",
              years: "triggers.interval.units.years",
            } as const;
            const unitLabel =
              unit in INTERVAL_UNIT_KEYS
                ? t(INTERVAL_UNIT_KEYS[unit as keyof typeof INTERVAL_UNIT_KEYS])
                : unit;
            configSummary = `${t("triggers.interval.every")} ${value} ${unitLabel}`;
            break;
          }
          case "schedule": {
            const frequency = (config.frequency as string) ?? "daily";
            const time = (config.time as string) ?? "";
            const timezone = (config.timezone as string) ?? "";
            const FREQ_KEYS = {
              daily: "triggers.schedule.frequencies.daily",
              weekly: "triggers.schedule.frequencies.weekly",
              monthly: "triggers.schedule.frequencies.monthly",
              yearly: "triggers.schedule.frequencies.yearly",
              weekdays: "triggers.schedule.frequencies.weekdays",
            } as const;
            const freqLabel =
              frequency in FREQ_KEYS
                ? t(FREQ_KEYS[frequency as keyof typeof FREQ_KEYS])
                : frequency;
            const parts = [freqLabel];
            if (time) parts.push(`${t("triggers.schedule.time")} ${time}`);
            if (timezone) parts.push(timezone);
            configSummary = parts.join(" \u00B7 ");
            break;
          }
          case "channel_message": {
            const channelId = config.channelId as string | undefined;
            configSummary = channelId
              ? `${t("triggers.channelMessage.channel")}: ${channelId}`
              : t("triggers.types.channel_message");
            break;
          }
        }

        return (
          <div
            key={trigger.id}
            className="rounded-md border border-border p-3 space-y-2"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Icon size={14} className="shrink-0 text-muted-foreground" />
                <span className="text-sm font-medium truncate">
                  {t(`triggers.types.${trigger.type}` as const)}
                </span>
                <Badge
                  variant={trigger.enabled ? "default" : "outline"}
                  className="text-xs shrink-0"
                >
                  {trigger.enabled
                    ? t("triggers.enabled")
                    : t("triggers.disabled")}
                </Badge>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Switch
                  checked={trigger.enabled}
                  onCheckedChange={(checked) =>
                    toggleMutation.mutate({
                      triggerId: trigger.id,
                      enabled: checked,
                    })
                  }
                  disabled={toggleMutation.isPending}
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-destructive hover:text-destructive"
                  disabled={deleteMutation.isPending}
                  onClick={() => {
                    if (window.confirm(t("triggers.deleteConfirm"))) {
                      deleteMutation.mutate(trigger.id);
                    }
                  }}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">{configSummary}</p>

            {/* Next run countdown */}
            {trigger.nextRunAt && trigger.enabled && (
              <p className="text-xs text-muted-foreground">
                {t("triggers.nextRun", {
                  time: new Date(trigger.nextRunAt).toLocaleString(),
                })}{" "}
                (
                {t("triggers.countdown", {
                  duration: formatCountdown(trigger.nextRunAt),
                })}
                )
              </p>
            )}

            {/* Last run */}
            {trigger.lastRunAt && (
              <p className="text-xs text-muted-foreground">
                {t("triggers.lastRun", {
                  time: new Date(trigger.lastRunAt).toLocaleString(),
                })}
              </p>
            )}
          </div>
        );
      })}

      <Button
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => setShowAddDialog(true)}
      >
        <Plus size={14} />
        {t("triggers.add")}
      </Button>

      <AddTriggerDialog
        taskId={taskId}
        isOpen={showAddDialog}
        onClose={() => setShowAddDialog(false)}
      />
    </div>
  );
}

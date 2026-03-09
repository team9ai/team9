/** @deprecated Replaced by the trigger system (AddTriggerDialog). Safe to delete. */
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AgentTaskScheduleType, ScheduleConfig } from "@/types/task";

const DAYS_OF_WEEK = [0, 1, 2, 3, 4, 5, 6] as const;
const FREQUENCIES = ["daily", "weekly", "monthly"] as const;

interface ScheduleConfigFormProps {
  scheduleType: AgentTaskScheduleType;
  scheduleConfig?: ScheduleConfig;
  onScheduleTypeChange: (type: AgentTaskScheduleType) => void;
  onConfigChange: (config: ScheduleConfig) => void;
}

export function ScheduleConfigForm({
  scheduleType,
  scheduleConfig,
  onScheduleTypeChange,
  onConfigChange,
}: ScheduleConfigFormProps) {
  const { t } = useTranslation("tasks");

  const frequency = scheduleConfig?.frequency ?? "daily";
  const time = scheduleConfig?.time ?? "09:00";
  const dayOfWeek = scheduleConfig?.dayOfWeek ?? 1;
  const dayOfMonth = scheduleConfig?.dayOfMonth ?? 1;

  function updateConfig(patch: Partial<ScheduleConfig>) {
    onConfigChange({ ...scheduleConfig, ...patch });
  }

  return (
    <div className="space-y-4">
      {/* Schedule type toggle */}
      <div className="space-y-1.5">
        <Label>{t("schedule.type")}</Label>
        <div className="flex gap-1 rounded-md border border-border p-0.5">
          {(["once", "recurring"] as const).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => onScheduleTypeChange(type)}
              className={cn(
                "flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors",
                scheduleType === type
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent",
              )}
            >
              {t(`schedule.types.${type}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Recurring options */}
      {scheduleType === "recurring" && (
        <>
          {/* Frequency selector */}
          <div className="space-y-1.5">
            <Label>{t("schedule.frequency")}</Label>
            <Select
              value={frequency}
              onValueChange={(val) => updateConfig({ frequency: val })}
            >
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FREQUENCIES.map((freq) => (
                  <SelectItem key={freq} value={freq}>
                    {t(`schedule.frequencies.${freq}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Time picker */}
          <div className="space-y-1.5">
            <Label>{t("schedule.time")}</Label>
            <Input
              type="time"
              value={time}
              onChange={(e) => updateConfig({ time: e.target.value })}
              className="h-9 text-sm"
            />
          </div>

          {/* Day of week (for weekly) */}
          {frequency === "weekly" && (
            <div className="space-y-1.5">
              <Label>{t("schedule.dayOfWeek")}</Label>
              <div className="flex gap-1">
                {DAYS_OF_WEEK.map((day) => (
                  <button
                    key={day}
                    type="button"
                    onClick={() => updateConfig({ dayOfWeek: day })}
                    className={cn(
                      "flex-1 rounded py-1.5 text-xs font-medium transition-colors",
                      dayOfWeek === day
                        ? "bg-primary text-primary-foreground"
                        : "border border-border text-muted-foreground hover:text-foreground hover:bg-accent",
                    )}
                  >
                    {t(`schedule.days.${day}`)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Day of month (for monthly) */}
          {frequency === "monthly" && (
            <div className="space-y-1.5">
              <Label>{t("schedule.dayOfMonth")}</Label>
              <Select
                value={String(dayOfMonth)}
                onValueChange={(val) =>
                  updateConfig({ dayOfMonth: parseInt(val, 10) })
                }
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                    <SelectItem key={day} value={String(day)}>
                      {day}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </>
      )}
    </div>
  );
}

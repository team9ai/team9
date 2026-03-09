import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Loader2,
  Hand,
  Timer,
  CalendarClock,
  MessageSquare,
  ArrowLeft,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { tasksApi } from "@/services/api/tasks";
import { channelsApi } from "@/services/api/im";
import type { AgentTaskTriggerType } from "@/types/task";

interface AddTriggerDialogProps {
  taskId: string;
  isOpen: boolean;
  onClose: () => void;
}

const TRIGGER_TYPES: {
  type: AgentTaskTriggerType;
  icon: typeof Hand;
  descriptionKey: string;
}[] = [
  { type: "manual", icon: Hand, descriptionKey: "triggers.typeDesc.manual" },
  {
    type: "interval",
    icon: Timer,
    descriptionKey: "triggers.typeDesc.interval",
  },
  {
    type: "schedule",
    icon: CalendarClock,
    descriptionKey: "triggers.typeDesc.schedule",
  },
  {
    type: "channel_message",
    icon: MessageSquare,
    descriptionKey: "triggers.typeDesc.channel_message",
  },
];

const INTERVAL_UNITS = [
  "minutes",
  "hours",
  "days",
  "weeks",
  "months",
  "years",
] as const;

const SCHEDULE_FREQUENCIES = [
  "daily",
  "weekly",
  "monthly",
  "yearly",
  "weekdays",
] as const;

export function AddTriggerDialog({
  taskId,
  isOpen,
  onClose,
}: AddTriggerDialogProps) {
  const { t } = useTranslation("tasks");
  const queryClient = useQueryClient();

  // Dialog state
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedType, setSelectedType] = useState<AgentTaskTriggerType | null>(
    null,
  );

  // Interval config
  const [intervalValue, setIntervalValue] = useState(1);
  const [intervalUnit, setIntervalUnit] = useState<string>("hours");

  // Schedule config
  const [scheduleFrequency, setScheduleFrequency] = useState("daily");
  const [scheduleTime, setScheduleTime] = useState("09:00");
  const [scheduleTimezone, setScheduleTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [scheduleDayOfWeek, setScheduleDayOfWeek] = useState(1);
  const [scheduleDayOfMonth, setScheduleDayOfMonth] = useState(1);

  // Channel message config
  const [channelId, setChannelId] = useState("");

  // Fetch channels for channel_message type
  const { data: channels = [] } = useQuery({
    queryKey: ["channels"],
    queryFn: () => channelsApi.getChannels(),
    enabled: isOpen && selectedType === "channel_message",
  });

  const nonDirectChannels = channels.filter((ch) => ch.type !== "direct");

  const createMutation = useMutation({
    mutationFn: () => {
      let config: Record<string, unknown> = {};

      switch (selectedType) {
        case "manual":
          config = {};
          break;
        case "interval":
          config = { value: intervalValue, unit: intervalUnit };
          break;
        case "schedule": {
          config = {
            frequency: scheduleFrequency,
            time: scheduleTime,
            timezone: scheduleTimezone,
          };
          if (scheduleFrequency === "weekly") {
            config.dayOfWeek = scheduleDayOfWeek;
          }
          if (scheduleFrequency === "monthly") {
            config.dayOfMonth = scheduleDayOfMonth;
          }
          break;
        }
        case "channel_message":
          config = { channelId };
          break;
      }

      return tasksApi.createTrigger(taskId, {
        type: selectedType!,
        config,
        enabled: true,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["task-triggers", taskId] });
      handleClose();
    },
  });

  function handleClose() {
    setStep(1);
    setSelectedType(null);
    setIntervalValue(1);
    setIntervalUnit("hours");
    setScheduleFrequency("daily");
    setScheduleTime("09:00");
    setScheduleTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    setScheduleDayOfWeek(1);
    setScheduleDayOfMonth(1);
    setChannelId("");
    createMutation.reset();
    onClose();
  }

  function handleSelectType(type: AgentTaskTriggerType) {
    setSelectedType(type);
    setStep(2);
  }

  function handleBack() {
    setStep(1);
    createMutation.reset();
  }

  const isCreateDisabled =
    createMutation.isPending ||
    (selectedType === "channel_message" && !channelId);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {step === 1
              ? t("triggers.addTitle")
              : t("triggers.configureTitle", {
                  type: t(`triggers.types.${selectedType}` as const),
                })}
          </DialogTitle>
        </DialogHeader>

        {/* Step 1: Select trigger type */}
        {step === 1 && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {t("triggers.selectType")}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {TRIGGER_TYPES.map(({ type, icon: Icon, descriptionKey }) => (
                <button
                  key={type}
                  type="button"
                  className="flex flex-col items-center gap-2 rounded-md border border-border p-3 hover:bg-accent hover:text-accent-foreground transition-colors cursor-pointer text-center"
                  onClick={() => handleSelectType(type)}
                >
                  <Icon size={20} className="text-muted-foreground" />
                  <span className="text-sm font-medium">
                    {t(`triggers.types.${type}` as const)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t(descriptionKey)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 2: Type-specific config */}
        {step === 2 && selectedType === "manual" && (
          <p className="text-sm text-muted-foreground">
            {t("triggers.manualNoConfig")}
          </p>
        )}

        {step === 2 && selectedType === "interval" && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{t("triggers.interval.every")}</Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  min={1}
                  value={intervalValue}
                  onChange={(e) =>
                    setIntervalValue(Math.max(1, parseInt(e.target.value) || 1))
                  }
                  className="w-20"
                />
                <Select value={intervalUnit} onValueChange={setIntervalUnit}>
                  <SelectTrigger className="flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INTERVAL_UNITS.map((unit) => (
                      <SelectItem key={unit} value={unit}>
                        {t(`triggers.interval.units.${unit}` as const)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        )}

        {step === 2 && selectedType === "schedule" && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{t("schedule.frequency")}</Label>
              <Select
                value={scheduleFrequency}
                onValueChange={setScheduleFrequency}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCHEDULE_FREQUENCIES.map((freq) => (
                    <SelectItem key={freq} value={freq}>
                      {t(`triggers.schedule.frequencies.${freq}` as const)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>{t("triggers.schedule.time")}</Label>
              <Input
                type="time"
                value={scheduleTime}
                onChange={(e) => setScheduleTime(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>{t("triggers.schedule.timezone")}</Label>
              <Input
                value={scheduleTimezone}
                onChange={(e) => setScheduleTimezone(e.target.value)}
                placeholder="America/New_York"
              />
            </div>

            {scheduleFrequency === "weekly" && (
              <div className="space-y-1.5">
                <Label>{t("triggers.schedule.dayOfWeek")}</Label>
                <Select
                  value={String(scheduleDayOfWeek)}
                  onValueChange={(v) => setScheduleDayOfWeek(Number(v))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[0, 1, 2, 3, 4, 5, 6].map((day) => (
                      <SelectItem key={day} value={String(day)}>
                        {t(`schedule.days.${day}` as const)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {scheduleFrequency === "monthly" && (
              <div className="space-y-1.5">
                <Label>{t("triggers.schedule.dayOfMonth")}</Label>
                <Input
                  type="number"
                  min={1}
                  max={31}
                  value={scheduleDayOfMonth}
                  onChange={(e) =>
                    setScheduleDayOfMonth(
                      Math.min(31, Math.max(1, parseInt(e.target.value) || 1)),
                    )
                  }
                />
              </div>
            )}
          </div>
        )}

        {step === 2 && selectedType === "channel_message" && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{t("triggers.channelMessage.channel")}</Label>
              <Select value={channelId} onValueChange={setChannelId}>
                <SelectTrigger>
                  <SelectValue
                    placeholder={t("triggers.channelMessage.selectChannel")}
                  />
                </SelectTrigger>
                <SelectContent>
                  {nonDirectChannels.map((ch) => (
                    <SelectItem key={ch.id} value={ch.id}>
                      # {ch.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {createMutation.isError && (
          <p className="text-sm text-destructive">
            {(createMutation.error as Error)?.message ||
              t("create.errorGeneric")}
          </p>
        )}

        {/* Footer */}
        {step === 2 && (
          <DialogFooter className="flex justify-between sm:justify-between">
            <Button variant="ghost" onClick={handleBack}>
              <ArrowLeft size={14} className="mr-1" />
              {t("triggers.back")}
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={isCreateDisabled}
            >
              {createMutation.isPending && (
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              )}
              {t("triggers.create")}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

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
import {
  INTERVAL_UNIT_LABEL_KEYS,
  SCHEDULE_DAY_OPTIONS,
  SCHEDULE_FREQUENCY_LABEL_KEYS,
  ROUTINE_TRIGGER_DESCRIPTION_KEYS,
  ROUTINE_TRIGGER_TYPE_LABEL_KEYS,
  type IntervalUnit,
  type ScheduleFrequency,
  isIntervalUnit,
  isScheduleFrequency,
} from "@/lib/routine-trigger-keys";
import { routinesApi } from "@/services/api/routines";
import { channelsApi } from "@/services/api/im";
import type { RoutineTriggerType } from "@/types/routine";

interface AddTriggerDialogProps {
  routineId: string;
  isOpen: boolean;
  onClose: () => void;
}

const TRIGGER_TYPES: {
  type: RoutineTriggerType;
  icon: typeof Hand;
}[] = [
  { type: "manual", icon: Hand },
  { type: "interval", icon: Timer },
  { type: "schedule", icon: CalendarClock },
  { type: "channel_message", icon: MessageSquare },
];

const INTERVAL_UNITS = Object.keys(INTERVAL_UNIT_LABEL_KEYS) as IntervalUnit[];

const SCHEDULE_FREQUENCIES = Object.keys(
  SCHEDULE_FREQUENCY_LABEL_KEYS,
) as ScheduleFrequency[];

export function AddTriggerDialog({
  routineId,
  isOpen,
  onClose,
}: AddTriggerDialogProps) {
  const { t } = useTranslation("routines");
  const queryClient = useQueryClient();

  // Dialog state
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedType, setSelectedType] = useState<RoutineTriggerType | null>(
    null,
  );

  // Interval config
  const [intervalValue, setIntervalValue] = useState(1);
  const [intervalUnit, setIntervalUnit] = useState<IntervalUnit>("hours");

  // Schedule config
  const [scheduleFrequency, setScheduleFrequency] =
    useState<ScheduleFrequency>("daily");
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

  const nonDirectChannels = channels.filter(
    (ch) =>
      ch.type !== "direct" &&
      ch.type !== "echo" &&
      ch.type !== "routine-session",
  );

  const createMutation = useMutation({
    mutationFn: () => {
      let config: Record<string, unknown> = {};

      switch (selectedType) {
        case "manual":
          config = {};
          break;
        case "interval":
          config = { every: intervalValue, unit: intervalUnit };
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

      return routinesApi.createTrigger(routineId, {
        type: selectedType!,
        config,
        enabled: true,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["routine-triggers", routineId],
      });
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

  function handleSelectType(type: RoutineTriggerType) {
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
              : selectedType
                ? t("triggers.configureTitle", {
                    type: t(ROUTINE_TRIGGER_TYPE_LABEL_KEYS[selectedType]),
                  })
                : t("triggers.addTitle")}
          </DialogTitle>
        </DialogHeader>

        {/* Step 1: Select trigger type */}
        {step === 1 && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {t("triggers.selectType")}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {TRIGGER_TYPES.map(({ type, icon: Icon }) => (
                <button
                  key={type}
                  type="button"
                  className="flex flex-col items-center gap-2 rounded-md border border-border p-3 hover:bg-accent hover:text-accent-foreground transition-colors cursor-pointer text-center"
                  onClick={() => handleSelectType(type)}
                >
                  <Icon size={20} className="text-muted-foreground" />
                  <span className="text-sm font-medium">
                    {t(ROUTINE_TRIGGER_TYPE_LABEL_KEYS[type])}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t(ROUTINE_TRIGGER_DESCRIPTION_KEYS[type])}
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
                <Select
                  value={intervalUnit}
                  onValueChange={(value) => {
                    if (isIntervalUnit(value)) {
                      setIntervalUnit(value);
                    }
                  }}
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INTERVAL_UNITS.map((unit) => (
                      <SelectItem key={unit} value={unit}>
                        {t(INTERVAL_UNIT_LABEL_KEYS[unit])}
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
                onValueChange={(value) => {
                  if (isScheduleFrequency(value)) {
                    setScheduleFrequency(value);
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCHEDULE_FREQUENCIES.map((freq) => (
                    <SelectItem key={freq} value={freq}>
                      {t(SCHEDULE_FREQUENCY_LABEL_KEYS[freq])}
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
                    {SCHEDULE_DAY_OPTIONS.map((day) => (
                      <SelectItem key={day.value} value={String(day.value)}>
                        {t(day.labelKey)}
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

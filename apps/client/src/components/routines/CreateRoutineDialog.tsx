import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger as SelectTriggerUI,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  Plus,
  X,
  Hand,
  Timer,
  CalendarClock,
  MessageSquare,
  ChevronDown,
} from "lucide-react";
import {
  INTERVAL_UNIT_LABEL_KEYS,
  SCHEDULE_DAY_OPTIONS,
  SCHEDULE_FREQUENCY_LABEL_KEYS,
  ROUTINE_TRIGGER_TYPE_LABEL_KEYS,
  type IntervalUnit,
  type ScheduleFrequency,
  isIntervalUnit,
  isScheduleFrequency,
} from "@/lib/routine-trigger-keys";
import { api } from "@/services/api";
import { channelsApi } from "@/services/api/im";
import { useSelectedWorkspaceId } from "@/stores/useWorkspaceStore";
import type { RoutineTriggerType, CreateTriggerDto } from "@/types/routine";

interface CreateRoutineDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const NO_BOT = "__none__";

const TRIGGER_TYPE_ICON: Record<RoutineTriggerType, typeof Hand> = {
  manual: Hand,
  interval: Timer,
  schedule: CalendarClock,
  channel_message: MessageSquare,
};

const TRIGGER_TYPE_OPTIONS: RoutineTriggerType[] = [
  "manual",
  "interval",
  "schedule",
  "channel_message",
];

const INTERVAL_UNITS = Object.keys(INTERVAL_UNIT_LABEL_KEYS) as IntervalUnit[];

const SCHEDULE_FREQUENCIES = Object.keys(
  SCHEDULE_FREQUENCY_LABEL_KEYS,
) as ScheduleFrequency[];

export function CreateRoutineDialog({
  isOpen,
  onClose,
}: CreateRoutineDialogProps) {
  const { t } = useTranslation("routines");
  const queryClient = useQueryClient();
  const workspaceId = useSelectedWorkspaceId();

  const [title, setTitle] = useState("");
  const [botId, setBotId] = useState<string>(NO_BOT);
  const [documentContent, setDocumentContent] = useState("");

  // Triggers
  const [triggers, setTriggers] = useState<CreateTriggerDto[]>([]);
  const [showTriggersSection, setShowTriggersSection] = useState(false);
  const [addingTrigger, setAddingTrigger] = useState(false);
  const [newTriggerType, setNewTriggerType] =
    useState<RoutineTriggerType>("manual");
  const [intervalValue, setIntervalValue] = useState(1);
  const [intervalUnit, setIntervalUnit] = useState<IntervalUnit>("hours");
  const [scheduleFrequency, setScheduleFrequency] =
    useState<ScheduleFrequency>("daily");
  const [scheduleTime, setScheduleTime] = useState("09:00");
  const [scheduleTimezone, setScheduleTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [scheduleDayOfWeek, setScheduleDayOfWeek] = useState(1);
  const [scheduleDayOfMonth, setScheduleDayOfMonth] = useState(1);
  const [channelId, setChannelId] = useState("");

  const { data: installedApps = [] } = useQuery({
    queryKey: ["installed-applications-with-bots", workspaceId],
    queryFn: () => api.applications.getInstalledApplicationsWithBots(),
    enabled: isOpen && !!workspaceId,
  });

  const allBots = useMemo(
    () =>
      installedApps
        .filter((a) => a.status === "active")
        .flatMap((a) => a.bots)
        .filter((b) => b.botId),
    [installedApps],
  );

  // Fetch channels for channel_message trigger type
  const { data: channels = [] } = useQuery({
    queryKey: ["channels"],
    queryFn: () => channelsApi.getChannels(),
    enabled: isOpen && addingTrigger && newTriggerType === "channel_message",
  });
  const nonDirectChannels = channels.filter(
    (ch) => ch.type !== "direct" && ch.type !== "echo",
  );

  const createMutation = useMutation({
    mutationFn: () =>
      api.routines.create({
        title: title.trim(),
        botId: botId === NO_BOT ? undefined : botId,
        documentContent: documentContent.trim() || undefined,
        triggers: triggers.length > 0 ? triggers : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["routines"] });
      handleClose();
    },
  });

  function handleClose() {
    setTitle("");
    setBotId(NO_BOT);
    setDocumentContent("");
    setTriggers([]);
    setShowTriggersSection(false);
    setAddingTrigger(false);
    resetTriggerForm();
    createMutation.reset();
    onClose();
  }

  function resetTriggerForm() {
    setNewTriggerType("manual");
    setIntervalValue(1);
    setIntervalUnit("hours");
    setScheduleFrequency("daily");
    setScheduleTime("09:00");
    setScheduleTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    setScheduleDayOfWeek(1);
    setScheduleDayOfMonth(1);
    setChannelId("");
  }

  function handleAddTrigger() {
    let config: Record<string, unknown> = {};
    switch (newTriggerType) {
      case "manual":
        config = {};
        break;
      case "interval":
        config = { every: intervalValue, unit: intervalUnit };
        break;
      case "schedule":
        config = {
          frequency: scheduleFrequency,
          time: scheduleTime,
          timezone: scheduleTimezone,
        };
        if (scheduleFrequency === "weekly")
          config.dayOfWeek = scheduleDayOfWeek;
        if (scheduleFrequency === "monthly")
          config.dayOfMonth = scheduleDayOfMonth;
        break;
      case "channel_message":
        config = { channelId };
        break;
    }
    setTriggers((prev) => [
      ...prev,
      { type: newTriggerType, config, enabled: true },
    ]);
    setAddingTrigger(false);
    resetTriggerForm();
  }

  function removeTrigger(index: number) {
    setTriggers((prev) => prev.filter((_, i) => i !== index));
  }

  function getTriggerSummary(trigger: CreateTriggerDto): string {
    const config = trigger.config ?? {};
    switch (trigger.type) {
      case "manual":
        return t(ROUTINE_TRIGGER_TYPE_LABEL_KEYS.manual);
      case "interval": {
        const unit = typeof config.unit === "string" ? config.unit : "hours";
        const unitLabel = isIntervalUnit(unit)
          ? t(INTERVAL_UNIT_LABEL_KEYS[unit])
          : unit;
        return `${t("triggers.interval.every")} ${config.every ?? 1} ${unitLabel}`;
      }
      case "schedule": {
        const frequency =
          typeof config.frequency === "string" ? config.frequency : "daily";
        const frequencyLabel = isScheduleFrequency(frequency)
          ? t(SCHEDULE_FREQUENCY_LABEL_KEYS[frequency])
          : frequency;
        const time = typeof config.time === "string" ? config.time : "";
        return `${frequencyLabel} ${t("triggers.schedule.time")} ${time}`.trim();
      }
      case "channel_message":
        return `${t("triggers.channelMessage.channel")}: ${typeof config.channelId === "string" ? config.channelId : ""}`;
      default:
        return "";
    }
  }

  const canAddCurrentTrigger =
    newTriggerType !== "channel_message" || channelId !== "";

  const canSubmit = title.trim().length > 0 && !createMutation.isPending;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("create.title")}</DialogTitle>
          <DialogDescription>{t("create.description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Title */}
          <div className="space-y-1.5">
            <Label htmlFor="routine-title">{t("create.taskName")}</Label>
            <Input
              id="routine-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={500}
              placeholder={t("create.taskNamePlaceholder")}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canSubmit) {
                  createMutation.mutate();
                }
              }}
              autoFocus
            />
          </div>

          {/* Bot select */}
          <div className="space-y-1.5">
            <Label>{t("create.bot")}</Label>
            <Select value={botId} onValueChange={setBotId}>
              <SelectTriggerUI className="w-full">
                <SelectValue placeholder={t("create.botPlaceholder")} />
              </SelectTriggerUI>
              <SelectContent>
                <SelectItem value={NO_BOT}>
                  <span className="text-muted-foreground">
                    {t("create.noBot")}
                  </span>
                </SelectItem>
                {allBots.map((bot) => (
                  <SelectItem key={bot.botId} value={bot.botId}>
                    {bot.displayName || bot.username}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Document content */}
          <div className="space-y-1.5">
            <Label htmlFor="routine-doc">{t("create.document")}</Label>
            <Textarea
              id="routine-doc"
              value={documentContent}
              onChange={(e) => setDocumentContent(e.target.value)}
              placeholder={t("create.documentPlaceholder")}
              rows={4}
              className="resize-none"
            />
          </div>

          {/* Triggers section */}
          <div className="space-y-2">
            <button
              type="button"
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setShowTriggersSection((v) => !v)}
            >
              <ChevronDown
                size={14}
                className={`transition-transform ${showTriggersSection ? "" : "-rotate-90"}`}
              />
              {t("triggers.title")}
              {triggers.length > 0 && (
                <span className="text-xs bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 leading-none">
                  {triggers.length}
                </span>
              )}
            </button>

            {showTriggersSection && (
              <div className="space-y-2 pl-1">
                {/* Added triggers list */}
                {triggers.map((trigger, index) => {
                  const Icon = TRIGGER_TYPE_ICON[trigger.type];
                  return (
                    <div
                      key={index}
                      className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-sm"
                    >
                      <Icon
                        size={14}
                        className="text-muted-foreground shrink-0"
                      />
                      <span className="truncate flex-1">
                        {getTriggerSummary(trigger)}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeTrigger(index)}
                        className="text-muted-foreground hover:text-destructive shrink-0"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  );
                })}

                {/* Inline add trigger form */}
                {addingTrigger ? (
                  <div className="space-y-2 rounded-md border border-border p-2.5">
                    {/* Type select */}
                    <div className="space-y-1">
                      <Label className="text-xs">
                        {t("triggers.selectType")}
                      </Label>
                      <Select
                        value={newTriggerType}
                        onValueChange={(v) =>
                          setNewTriggerType(v as RoutineTriggerType)
                        }
                      >
                        <SelectTriggerUI>
                          <SelectValue />
                        </SelectTriggerUI>
                        <SelectContent>
                          {TRIGGER_TYPE_OPTIONS.map((type) => (
                            <SelectItem key={type} value={type}>
                              {t(ROUTINE_TRIGGER_TYPE_LABEL_KEYS[type])}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Type-specific config */}
                    {newTriggerType === "manual" && (
                      <p className="text-xs text-muted-foreground">
                        {t("triggers.manualNoConfig")}
                      </p>
                    )}

                    {newTriggerType === "interval" && (
                      <div className="flex gap-2">
                        <Input
                          type="number"
                          min={1}
                          value={intervalValue}
                          onChange={(e) =>
                            setIntervalValue(
                              Math.max(1, parseInt(e.target.value) || 1),
                            )
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
                          <SelectTriggerUI className="flex-1">
                            <SelectValue />
                          </SelectTriggerUI>
                          <SelectContent>
                            {INTERVAL_UNITS.map((unit) => (
                              <SelectItem key={unit} value={unit}>
                                {t(INTERVAL_UNIT_LABEL_KEYS[unit])}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    {newTriggerType === "schedule" && (
                      <div className="space-y-2">
                        <Select
                          value={scheduleFrequency}
                          onValueChange={(value) => {
                            if (isScheduleFrequency(value)) {
                              setScheduleFrequency(value);
                            }
                          }}
                        >
                          <SelectTriggerUI>
                            <SelectValue />
                          </SelectTriggerUI>
                          <SelectContent>
                            {SCHEDULE_FREQUENCIES.map((freq) => (
                              <SelectItem key={freq} value={freq}>
                                {t(SCHEDULE_FREQUENCY_LABEL_KEYS[freq])}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Input
                          type="time"
                          value={scheduleTime}
                          onChange={(e) => setScheduleTime(e.target.value)}
                        />
                        <Input
                          value={scheduleTimezone}
                          onChange={(e) => setScheduleTimezone(e.target.value)}
                          placeholder="America/New_York"
                          className="text-xs"
                        />
                        {scheduleFrequency === "weekly" && (
                          <Select
                            value={String(scheduleDayOfWeek)}
                            onValueChange={(v) =>
                              setScheduleDayOfWeek(Number(v))
                            }
                          >
                            <SelectTriggerUI>
                              <SelectValue />
                            </SelectTriggerUI>
                            <SelectContent>
                              {SCHEDULE_DAY_OPTIONS.map((day) => (
                                <SelectItem
                                  key={day.value}
                                  value={String(day.value)}
                                >
                                  {t(day.labelKey)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                        {scheduleFrequency === "monthly" && (
                          <Input
                            type="number"
                            min={1}
                            max={31}
                            value={scheduleDayOfMonth}
                            onChange={(e) =>
                              setScheduleDayOfMonth(
                                Math.min(
                                  31,
                                  Math.max(1, parseInt(e.target.value) || 1),
                                ),
                              )
                            }
                          />
                        )}
                      </div>
                    )}

                    {newTriggerType === "channel_message" && (
                      <Select value={channelId} onValueChange={setChannelId}>
                        <SelectTriggerUI>
                          <SelectValue
                            placeholder={t(
                              "triggers.channelMessage.selectChannel",
                            )}
                          />
                        </SelectTriggerUI>
                        <SelectContent>
                          {nonDirectChannels.map((ch) => (
                            <SelectItem key={ch.id} value={ch.id}>
                              # {ch.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}

                    {/* Add / Cancel buttons */}
                    <div className="flex gap-2 justify-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setAddingTrigger(false);
                          resetTriggerForm();
                        }}
                      >
                        {t("create.cancel")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={handleAddTrigger}
                        disabled={!canAddCurrentTrigger}
                      >
                        {t("triggers.add")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => setAddingTrigger(true)}
                  >
                    <Plus size={14} />
                    {t("triggers.add")}
                  </Button>
                )}
              </div>
            )}
          </div>

          {createMutation.isError && (
            <p className="text-sm text-destructive">
              {(createMutation.error as Error)?.message ||
                t("create.errorGeneric")}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={handleClose}>
            {t("create.cancel")}
          </Button>
          <Button onClick={() => createMutation.mutate()} disabled={!canSubmit}>
            {createMutation.isPending && (
              <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
            )}
            {t("create.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

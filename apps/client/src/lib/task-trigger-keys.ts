import type { AgentTaskTriggerType } from "@/types/task";

function hasOwnKey<T extends object>(
  object: T,
  key: PropertyKey,
): key is keyof T {
  return Object.prototype.hasOwnProperty.call(object, key);
}

export const TASK_TRIGGER_TYPE_LABEL_KEYS = {
  manual: "triggers.types.manual",
  interval: "triggers.types.interval",
  schedule: "triggers.types.schedule",
  channel_message: "triggers.types.channel_message",
} as const satisfies Record<AgentTaskTriggerType, string>;

export const TASK_TRIGGER_DESCRIPTION_KEYS = {
  manual: "triggers.typeDesc.manual",
  interval: "triggers.typeDesc.interval",
  schedule: "triggers.typeDesc.schedule",
  channel_message: "triggers.typeDesc.channel_message",
} as const satisfies Record<AgentTaskTriggerType, string>;

export const HISTORY_TRIGGER_TYPE_LABEL_KEYS = {
  manual: "historyTab.manual",
  interval: "historyTab.interval",
  schedule: "historyTab.schedule",
  channel_message: "historyTab.channelMessage",
  retry: "historyTab.retry",
} as const;

export type HistoryTriggerType = keyof typeof HISTORY_TRIGGER_TYPE_LABEL_KEYS;

export function isHistoryTriggerType(
  value: string,
): value is HistoryTriggerType {
  return hasOwnKey(HISTORY_TRIGGER_TYPE_LABEL_KEYS, value);
}

export const INTERVAL_UNIT_LABEL_KEYS = {
  minutes: "triggers.interval.units.minutes",
  hours: "triggers.interval.units.hours",
  days: "triggers.interval.units.days",
  weeks: "triggers.interval.units.weeks",
  months: "triggers.interval.units.months",
  years: "triggers.interval.units.years",
} as const;

export type IntervalUnit = keyof typeof INTERVAL_UNIT_LABEL_KEYS;

export function isIntervalUnit(value: string): value is IntervalUnit {
  return hasOwnKey(INTERVAL_UNIT_LABEL_KEYS, value);
}

export const SCHEDULE_FREQUENCY_LABEL_KEYS = {
  daily: "triggers.schedule.frequencies.daily",
  weekly: "triggers.schedule.frequencies.weekly",
  monthly: "triggers.schedule.frequencies.monthly",
  yearly: "triggers.schedule.frequencies.yearly",
  weekdays: "triggers.schedule.frequencies.weekdays",
} as const;

export type ScheduleFrequency = keyof typeof SCHEDULE_FREQUENCY_LABEL_KEYS;

export function isScheduleFrequency(value: string): value is ScheduleFrequency {
  return hasOwnKey(SCHEDULE_FREQUENCY_LABEL_KEYS, value);
}

export const SCHEDULE_DAY_OPTIONS = [
  { value: 0, labelKey: "schedule.days.0" },
  { value: 1, labelKey: "schedule.days.1" },
  { value: 2, labelKey: "schedule.days.2" },
  { value: 3, labelKey: "schedule.days.3" },
  { value: 4, labelKey: "schedule.days.4" },
  { value: 5, labelKey: "schedule.days.5" },
  { value: 6, labelKey: "schedule.days.6" },
] as const;

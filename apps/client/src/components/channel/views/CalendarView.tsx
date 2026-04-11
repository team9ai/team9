import { useState, useMemo, useCallback, useRef, DragEvent } from "react";
import { ChevronLeft, ChevronRight, Loader2, Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useViewMessages } from "@/hooks/useChannelViews";
import { usePropertyDefinitions } from "@/hooks/usePropertyDefinitions";
import { useUpdateView } from "@/hooks/useChannelViews";
import { messagePropertiesApi } from "@/services/api/properties";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { ViewConfigPanel } from "./ViewConfigPanel";
import { cn } from "@/lib/utils";
import type {
  ChannelView,
  PropertyDefinition,
  ViewMessageItem,
  ViewMessagesFlatResponse,
  ViewMessagesGroupedResponse,
  ViewConfig,
} from "@/types/properties";

export interface CalendarViewProps {
  channelId: string;
  view: ChannelView;
}

// ==================== Types ====================

type CalendarMode = "month" | "week" | "day";

interface RecurringRule {
  freq: "weekly" | "monthly";
  interval?: number;
  byDay?: string[]; // ["MO", "WE", "FR"]
  byMonthDay?: number[]; // [1, 15]
  endDate?: string;
}

interface CalendarEvent {
  message: ViewMessageItem;
  startDate: Date;
  endDate: Date | null;
  isRecurring: boolean;
  isRecurrenceInstance?: boolean;
  hour?: number; // hour of day for time-based placement
}

// ==================== Date Helpers ====================

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

const DAY_ABBR_TO_NUM: Record<string, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
};

function getMonthDays(year: number, month: number) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDayOfWeek = firstDay.getDay();
  const daysInMonth = lastDay.getDate();

  const days: { date: Date; isCurrentMonth: boolean }[] = [];

  const prevMonthLastDay = new Date(year, month, 0).getDate();
  for (let i = startDayOfWeek - 1; i >= 0; i--) {
    days.push({
      date: new Date(year, month - 1, prevMonthLastDay - i),
      isCurrentMonth: false,
    });
  }

  for (let d = 1; d <= daysInMonth; d++) {
    days.push({ date: new Date(year, month, d), isCurrentMonth: true });
  }

  const remaining = 42 - days.length;
  for (let d = 1; d <= remaining; d++) {
    days.push({
      date: new Date(year, month + 1, d),
      isCurrentMonth: false,
    });
  }

  return days;
}

function getWeekDays(year: number, month: number, dayOfMonth: number) {
  const ref = new Date(year, month, dayOfMonth);
  const dayOfWeek = ref.getDay();
  const sunday = new Date(ref);
  sunday.setDate(ref.getDate() - dayOfWeek);

  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(sunday);
    d.setDate(sunday.getDate() + i);
    return { date: d, isCurrentMonth: d.getMonth() === month };
  });
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function isToday(date: Date): boolean {
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function isSameDay(a: Date, b: Date): boolean {
  return dateKey(a) === dateKey(b);
}

function daysBetween(a: Date, b: Date): number {
  const msPerDay = 86400000;
  const aStart = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const bStart = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((bStart.getTime() - aStart.getTime()) / msPerDay);
}

// ==================== Recurring Expansion ====================

function expandRecurring(
  rule: RecurringRule,
  baseDate: Date,
  rangeStart: Date,
  rangeEnd: Date,
): Date[] {
  const dates: Date[] = [];
  const interval = rule.interval ?? 1;
  const endDate = rule.endDate ? new Date(rule.endDate) : rangeEnd;
  const limit = Math.min(endDate.getTime(), rangeEnd.getTime());

  if (rule.freq === "weekly") {
    const targetDays = rule.byDay
      ? rule.byDay.map((d) => DAY_ABBR_TO_NUM[d.toUpperCase()] ?? 0)
      : [baseDate.getDay()];

    // Start from the week of baseDate, iterate by interval weeks
    const weekStart = new Date(baseDate);
    weekStart.setDate(baseDate.getDate() - baseDate.getDay());

    const current = new Date(weekStart);
    while (current.getTime() <= limit) {
      for (const dow of targetDays) {
        const candidate = new Date(current);
        candidate.setDate(current.getDate() + dow);
        if (
          candidate.getTime() >= rangeStart.getTime() &&
          candidate.getTime() <= limit &&
          !isSameDay(candidate, baseDate)
        ) {
          dates.push(candidate);
        }
      }
      current.setDate(current.getDate() + 7 * interval);
      if (dates.length > 200) break; // safety limit
    }
  } else if (rule.freq === "monthly") {
    const targetDays = rule.byMonthDay ?? [baseDate.getDate()];

    const currentMonth = new Date(
      baseDate.getFullYear(),
      baseDate.getMonth(),
      1,
    );
    while (currentMonth.getTime() <= limit) {
      for (const dom of targetDays) {
        const lastDay = new Date(
          currentMonth.getFullYear(),
          currentMonth.getMonth() + 1,
          0,
        ).getDate();
        if (dom > lastDay) continue;
        const candidate = new Date(
          currentMonth.getFullYear(),
          currentMonth.getMonth(),
          dom,
        );
        if (
          candidate.getTime() >= rangeStart.getTime() &&
          candidate.getTime() <= limit &&
          !isSameDay(candidate, baseDate)
        ) {
          dates.push(candidate);
        }
      }
      currentMonth.setMonth(currentMonth.getMonth() + interval);
      if (dates.length > 200) break;
    }
  }

  return dates;
}

// ==================== Property Value Extraction ====================

function getDatePropertyValue(
  message: ViewMessageItem,
  defId: string,
): { start: Date; end: Date | null; hour: number | null } | null {
  const val = message.properties[defId];
  if (!val) return null;

  // date_range or timestamp_range: { start, end }
  if (
    typeof val === "object" &&
    val !== null &&
    "start" in (val as Record<string, unknown>)
  ) {
    const obj = val as Record<string, unknown>;
    const start = obj.start ? new Date(obj.start as string) : null;
    const end = obj.end ? new Date(obj.end as string) : null;
    if (!start || isNaN(start.getTime())) return null;
    const hour =
      start.getHours() !== 0 || start.getMinutes() !== 0
        ? start.getHours()
        : null;
    return {
      start,
      end: end && !isNaN(end.getTime()) ? end : null,
      hour,
    };
  }

  const d = new Date(val as string);
  if (isNaN(d.getTime())) return null;
  const hour = d.getHours() !== 0 || d.getMinutes() !== 0 ? d.getHours() : null;
  return { start: d, end: null, hour };
}

function getRecurringRule(message: ViewMessageItem): RecurringRule | null {
  // Look for a "recurring" property
  const val = message.properties["recurring"];
  if (!val || typeof val !== "object") return null;
  const obj = val as Record<string, unknown>;
  if (!obj.freq) return null;
  return obj as unknown as RecurringRule;
}

// ==================== Build Calendar Events ====================

function buildEvents(
  messages: ViewMessageItem[],
  datePropertyId: string,
  rangeStart: Date,
  rangeEnd: Date,
): CalendarEvent[] {
  const events: CalendarEvent[] = [];

  for (const msg of messages) {
    const dateInfo = getDatePropertyValue(msg, datePropertyId);
    if (!dateInfo) continue;

    const recurring = getRecurringRule(msg);
    const baseEvent: CalendarEvent = {
      message: msg,
      startDate: dateInfo.start,
      endDate: dateInfo.end,
      isRecurring: !!recurring,
      hour: dateInfo.hour ?? undefined,
    };
    events.push(baseEvent);

    // Expand recurring instances
    if (recurring) {
      const instances = expandRecurring(
        recurring,
        dateInfo.start,
        rangeStart,
        rangeEnd,
      );
      for (const instanceDate of instances) {
        events.push({
          message: msg,
          startDate: instanceDate,
          endDate: null,
          isRecurring: true,
          isRecurrenceInstance: true,
          hour: dateInfo.hour ?? undefined,
        });
      }
    }
  }

  return events;
}

// ==================== Helpers ====================

function extractMessages(
  data: ViewMessagesFlatResponse | ViewMessagesGroupedResponse | undefined,
): ViewMessageItem[] {
  if (!data) return [];
  if ("messages" in data) return data.messages;
  if ("groups" in data) return data.groups.flatMap((g) => g.messages);
  return [];
}

function getEventText(msg: ViewMessageItem): string {
  return msg.content ? msg.content.replace(/<[^>]+>/g, "") : "...";
}

// ==================== Event Card ====================

function EventCard({
  event,
  compact,
  onDragStart,
}: {
  event: CalendarEvent;
  compact?: boolean;
  onDragStart?: (e: DragEvent<HTMLDivElement>, event: CalendarEvent) => void;
}) {
  const text = getEventText(event.message);
  const displayText = compact
    ? text.length > 20
      ? text.slice(0, 20) + "..."
      : text
    : text.length > 40
      ? text.slice(0, 40) + "..."
      : text;

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart?.(e, event)}
      className={cn(
        "text-[10px] leading-tight truncate rounded px-1 py-0.5 cursor-grab",
        "bg-primary/10 text-foreground hover:bg-primary/20 transition-colors",
        event.isRecurring && "border-l-2 border-primary/40",
      )}
      title={text}
    >
      <span className="flex items-center gap-0.5">
        {event.isRecurring && (
          <Repeat className="h-2.5 w-2.5 shrink-0 opacity-60" />
        )}
        {displayText}
      </span>
    </div>
  );
}

// ==================== Range Bar (multi-day event) ====================

function RangeBar({
  event,
  startCol,
  spanCols,
}: {
  event: CalendarEvent;
  startCol: number;
  spanCols: number;
}) {
  const text = getEventText(event.message);
  return (
    <div
      className="absolute top-0 h-4 bg-primary/20 border border-primary/30 rounded text-[9px] leading-none flex items-center px-1 truncate z-10"
      style={{
        left: `${(startCol / 7) * 100}%`,
        width: `${(spanCols / 7) * 100}%`,
      }}
      title={text}
    >
      {event.isRecurring && (
        <Repeat className="h-2 w-2 mr-0.5 shrink-0 opacity-60" />
      )}
      {text.length > 30 ? text.slice(0, 30) + "..." : text}
    </div>
  );
}

// ==================== Month Cell ====================

function MonthCell({
  date,
  isCurrentMonth,
  events,
  onEmptyClick,
  onDragOver,
  onDrop,
  onDragStart,
}: {
  date: Date;
  isCurrentMonth: boolean;
  events: CalendarEvent[];
  onEmptyClick: (date: Date) => void;
  onDragOver: (e: DragEvent<HTMLDivElement>) => void;
  onDrop: (e: DragEvent<HTMLDivElement>, date: Date) => void;
  onDragStart: (e: DragEvent<HTMLDivElement>, event: CalendarEvent) => void;
}) {
  const today = isToday(date);
  const singleDayEvents = events.filter(
    (ev) => !ev.endDate || isSameDay(ev.startDate, ev.endDate),
  );

  return (
    <div
      className={cn(
        "border border-border p-1 min-h-[80px] overflow-hidden relative",
        !isCurrentMonth && "bg-muted/20",
      )}
      onDragOver={onDragOver}
      onDrop={(e) => onDrop(e, date)}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("[data-event-card]")) return;
        onEmptyClick(date);
      }}
    >
      <div className="flex items-center justify-between mb-0.5">
        <span
          className={cn(
            "text-xs",
            !isCurrentMonth && "text-muted-foreground/50",
            today &&
              "bg-primary text-primary-foreground rounded-full w-5 h-5 flex items-center justify-center font-medium",
          )}
        >
          {date.getDate()}
        </span>
        {singleDayEvents.length > 0 && (
          <span className="text-[10px] text-muted-foreground">
            {singleDayEvents.length}
          </span>
        )}
      </div>
      <div className="space-y-0.5" data-event-card>
        {singleDayEvents.slice(0, 3).map((ev, i) => (
          <EventCard
            key={`${ev.message.id}-${i}`}
            event={ev}
            compact
            onDragStart={onDragStart}
          />
        ))}
        {singleDayEvents.length > 3 && (
          <div className="text-[10px] text-muted-foreground px-1">
            +{singleDayEvents.length - 3} more
          </div>
        )}
      </div>
    </div>
  );
}

// ==================== Week View ====================

function WeekView({
  days,
  eventsByDate,
  onEmptyClick,
  onDragOver,
  onDrop,
  onDragStart,
}: {
  days: { date: Date; isCurrentMonth: boolean }[];
  eventsByDate: Map<string, CalendarEvent[]>;
  onEmptyClick: (date: Date, hour?: number) => void;
  onDragOver: (e: DragEvent<HTMLDivElement>) => void;
  onDrop: (e: DragEvent<HTMLDivElement>, date: Date) => void;
  onDragStart: (e: DragEvent<HTMLDivElement>, event: CalendarEvent) => void;
}) {
  return (
    <div className="flex flex-col flex-1 overflow-auto">
      {/* Day headers */}
      <div className="grid grid-cols-[60px_repeat(7,1fr)] sticky top-0 bg-background z-20">
        <div className="border-b border-border" />
        {days.map((day) => (
          <div
            key={dateKey(day.date)}
            className={cn(
              "text-center text-xs font-medium py-1.5 border-b border-border",
              isToday(day.date) && "text-primary font-bold",
            )}
          >
            {DAY_NAMES[day.date.getDay()]} {day.date.getDate()}
          </div>
        ))}
      </div>

      {/* All-day row for events without time */}
      <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-border">
        <div className="text-[10px] text-muted-foreground px-1 py-1 border-r border-border">
          All day
        </div>
        {days.map((day) => {
          const key = dateKey(day.date);
          const allDay = (eventsByDate.get(key) ?? []).filter(
            (ev) => ev.hour == null,
          );
          return (
            <div
              key={key}
              className="border-r border-border p-0.5 min-h-[28px]"
              onDragOver={onDragOver}
              onDrop={(e) => onDrop(e, day.date)}
              onClick={() => onEmptyClick(day.date)}
            >
              {allDay.slice(0, 2).map((ev, i) => (
                <EventCard
                  key={`${ev.message.id}-${i}`}
                  event={ev}
                  compact
                  onDragStart={onDragStart}
                />
              ))}
              {allDay.length > 2 && (
                <span className="text-[9px] text-muted-foreground">
                  +{allDay.length - 2}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Hourly rows */}
      {HOURS.map((hour) => (
        <div
          key={hour}
          className="grid grid-cols-[60px_repeat(7,1fr)] min-h-[36px]"
        >
          <div className="text-[10px] text-muted-foreground px-1 py-0.5 border-r border-b border-border text-right pr-2">
            {hour}:00
          </div>
          {days.map((day) => {
            const key = dateKey(day.date);
            const hourEvents = (eventsByDate.get(key) ?? []).filter(
              (ev) => ev.hour === hour,
            );
            return (
              <div
                key={key}
                className="border-r border-b border-border p-0.5"
                onDragOver={onDragOver}
                onDrop={(e) => onDrop(e, day.date)}
                onClick={() => onEmptyClick(day.date, hour)}
              >
                {hourEvents.map((ev, i) => (
                  <EventCard
                    key={`${ev.message.id}-${i}`}
                    event={ev}
                    compact
                    onDragStart={onDragStart}
                  />
                ))}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ==================== Day View ====================

function DayView({
  date,
  events,
  onEmptyClick,
  onDragOver,
  onDrop,
  onDragStart,
}: {
  date: Date;
  events: CalendarEvent[];
  onEmptyClick: (date: Date, hour?: number) => void;
  onDragOver: (e: DragEvent<HTMLDivElement>) => void;
  onDrop: (e: DragEvent<HTMLDivElement>, date: Date) => void;
  onDragStart: (e: DragEvent<HTMLDivElement>, event: CalendarEvent) => void;
}) {
  const allDayEvents = events.filter((ev) => ev.hour == null);
  const today = isToday(date);

  return (
    <div className="flex flex-col flex-1 overflow-auto">
      {/* Header */}
      <div
        className={cn(
          "text-center text-sm font-medium py-2 border-b border-border sticky top-0 bg-background z-20",
          today && "text-primary font-bold",
        )}
      >
        {DAY_NAMES[date.getDay()]} {date.getDate()}{" "}
        {MONTH_NAMES[date.getMonth()]}
      </div>

      {/* All-day row */}
      {allDayEvents.length > 0 && (
        <div className="border-b border-border p-1">
          <span className="text-[10px] text-muted-foreground mr-1">
            All day:
          </span>
          <div className="space-y-0.5 mt-0.5">
            {allDayEvents.map((ev, i) => (
              <EventCard
                key={`${ev.message.id}-${i}`}
                event={ev}
                onDragStart={onDragStart}
              />
            ))}
          </div>
        </div>
      )}

      {/* Hourly slots */}
      {HOURS.map((hour) => {
        const hourEvents = events.filter((ev) => ev.hour === hour);
        return (
          <div
            key={hour}
            className="flex min-h-[40px] border-b border-border"
            onDragOver={onDragOver}
            onDrop={(e) => onDrop(e, date)}
            onClick={() => onEmptyClick(date, hour)}
          >
            <div className="w-[60px] text-[10px] text-muted-foreground text-right pr-2 py-1 border-r border-border shrink-0">
              {hour}:00
            </div>
            <div className="flex-1 p-0.5 space-y-0.5">
              {hourEvents.map((ev, i) => (
                <EventCard
                  key={`${ev.message.id}-${i}`}
                  event={ev}
                  onDragStart={onDragStart}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ==================== Date Property Selector ====================

function DatePropertySelector({
  definitions,
  selectedId,
  onChange,
}: {
  definitions: PropertyDefinition[];
  selectedId: string | undefined;
  onChange: (id: string) => void;
}) {
  const dateDefs = useMemo(
    () =>
      definitions.filter((d) =>
        ["date", "timestamp", "date_range", "timestamp_range"].includes(
          d.valueType,
        ),
      ),
    [definitions],
  );

  if (dateDefs.length === 0) {
    return (
      <span className="text-xs text-muted-foreground">
        No date properties available. Create a date property first.
      </span>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">Date property:</span>
      <Select value={selectedId ?? ""} onValueChange={onChange}>
        <SelectTrigger className="h-7 text-xs w-40">
          <SelectValue placeholder="Select property" />
        </SelectTrigger>
        <SelectContent>
          {dateDefs.map((d) => (
            <SelectItem key={d.id} value={d.key} className="text-xs">
              {d.key}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ==================== Mode Toggle ====================

function ModeToggle({
  mode,
  onChange,
}: {
  mode: CalendarMode;
  onChange: (m: CalendarMode) => void;
}) {
  return (
    <div className="flex items-center rounded-md border border-border overflow-hidden">
      {(["month", "week", "day"] as CalendarMode[]).map((m) => (
        <button
          key={m}
          className={cn(
            "px-2.5 py-1 text-xs capitalize transition-colors",
            m === mode
              ? "bg-primary text-primary-foreground"
              : "hover:bg-muted text-muted-foreground",
          )}
          onClick={() => onChange(m)}
        >
          {m}
        </button>
      ))}
    </div>
  );
}

// ==================== Simple Create Form ====================

function CreateEventForm({
  date,
  hour,
  datePropertyKey,
  definitions,
  channelId: _channelId,
  onClose,
}: {
  date: Date;
  hour?: number;
  datePropertyKey: string;
  definitions: PropertyDefinition[];
  channelId?: string;
  onClose: () => void;
}) {
  const def = definitions.find((d) => d.key === datePropertyKey);
  const dateStr =
    hour != null
      ? `${dateKey(date)}T${String(hour).padStart(2, "0")}:00:00`
      : dateKey(date);

  return (
    <div
      className="fixed inset-0 bg-black/30 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-background border border-border rounded-lg p-4 w-80 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-medium mb-2">Create event</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Date: <span className="font-mono">{dateStr}</span>
          {def && <> (property: {def.key})</>}
        </p>
        <p className="text-xs text-muted-foreground mb-3">
          To create an event, send a message in this channel and set the &ldquo;
          {datePropertyKey}&rdquo; property to this date.
        </p>
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

// ==================== Main CalendarView ====================

export function CalendarView({ channelId, view }: CalendarViewProps) {
  const { data: definitions = [] } = usePropertyDefinitions(channelId);
  const { data: messagesData, isLoading } = useViewMessages(channelId, view.id);
  const updateView = useUpdateView(channelId);

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [dayOfMonth, setDayOfMonth] = useState(now.getDate());
  const [mode, setMode] = useState<CalendarMode>(
    view.config.defaultCalendarView ?? "month",
  );

  // Create form state
  const [createForm, setCreateForm] = useState<{
    date: Date;
    hour?: number;
  } | null>(null);

  // Drag state
  const draggedEventRef = useRef<CalendarEvent | null>(null);

  const datePropertyId = view.config.groupBy;

  const messages = useMemo(() => extractMessages(messagesData), [messagesData]);

  // Compute visible date range based on mode
  const { rangeStart, rangeEnd } = useMemo(() => {
    if (mode === "month") {
      const days = getMonthDays(year, month);
      return { rangeStart: days[0].date, rangeEnd: days[days.length - 1].date };
    } else if (mode === "week") {
      const days = getWeekDays(year, month, dayOfMonth);
      return { rangeStart: days[0].date, rangeEnd: days[6].date };
    } else {
      const d = new Date(year, month, dayOfMonth);
      return { rangeStart: d, rangeEnd: d };
    }
  }, [mode, year, month, dayOfMonth]);

  // Build calendar events (with recurring expansion and date ranges)
  const calendarEvents = useMemo(() => {
    if (!datePropertyId) return [];
    return buildEvents(messages, datePropertyId, rangeStart, rangeEnd);
  }, [messages, datePropertyId, rangeStart, rangeEnd]);

  // Group events by date key
  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const ev of calendarEvents) {
      // For range events, add to each day in the range
      if (ev.endDate && !isSameDay(ev.startDate, ev.endDate)) {
        const span = Math.min(daysBetween(ev.startDate, ev.endDate), 60);
        for (let i = 0; i <= span; i++) {
          const d = new Date(ev.startDate);
          d.setDate(d.getDate() + i);
          const key = dateKey(d);
          if (!map.has(key)) map.set(key, []);
          map.get(key)!.push(ev);
        }
      } else {
        const key = dateKey(ev.startDate);
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(ev);
      }
    }
    return map;
  }, [calendarEvents]);

  // Month view days
  const monthDays = useMemo(() => getMonthDays(year, month), [year, month]);

  // Week view days
  const weekDays = useMemo(
    () => getWeekDays(year, month, dayOfMonth),
    [year, month, dayOfMonth],
  );

  // Multi-day range events for the "all-day" row in month view
  const rangeEvents = useMemo(() => {
    return calendarEvents.filter(
      (ev) => ev.endDate && !isSameDay(ev.startDate, ev.endDate),
    );
  }, [calendarEvents]);

  // ==================== Navigation ====================

  const goToPrev = useCallback(() => {
    if (mode === "month") {
      if (month === 0) {
        setYear((y) => y - 1);
        setMonth(11);
      } else setMonth((m) => m - 1);
    } else if (mode === "week") {
      const d = new Date(year, month, dayOfMonth - 7);
      setYear(d.getFullYear());
      setMonth(d.getMonth());
      setDayOfMonth(d.getDate());
    } else {
      const d = new Date(year, month, dayOfMonth - 1);
      setYear(d.getFullYear());
      setMonth(d.getMonth());
      setDayOfMonth(d.getDate());
    }
  }, [mode, month, year, dayOfMonth]);

  const goToNext = useCallback(() => {
    if (mode === "month") {
      if (month === 11) {
        setYear((y) => y + 1);
        setMonth(0);
      } else setMonth((m) => m + 1);
    } else if (mode === "week") {
      const d = new Date(year, month, dayOfMonth + 7);
      setYear(d.getFullYear());
      setMonth(d.getMonth());
      setDayOfMonth(d.getDate());
    } else {
      const d = new Date(year, month, dayOfMonth + 1);
      setYear(d.getFullYear());
      setMonth(d.getMonth());
      setDayOfMonth(d.getDate());
    }
  }, [mode, month, year, dayOfMonth]);

  const goToToday = useCallback(() => {
    const today = new Date();
    setYear(today.getFullYear());
    setMonth(today.getMonth());
    setDayOfMonth(today.getDate());
  }, []);

  // ==================== Config Updates ====================

  const handleUpdateConfig = useCallback(
    (config: ViewConfig) => {
      updateView.mutate({ viewId: view.id, data: { config } });
    },
    [updateView, view.id],
  );

  const handleDatePropertyChange = useCallback(
    (id: string) => {
      handleUpdateConfig({ ...view.config, groupBy: id });
    },
    [view.config, handleUpdateConfig],
  );

  const handleModeChange = useCallback(
    (m: CalendarMode) => {
      setMode(m);
      handleUpdateConfig({ ...view.config, defaultCalendarView: m });
    },
    [view.config, handleUpdateConfig],
  );

  // ==================== Click empty date ====================

  const handleEmptyClick = useCallback(
    (date: Date, hour?: number) => {
      if (!datePropertyId) return;
      setCreateForm({ date, hour });
    },
    [datePropertyId],
  );

  // ==================== Drag and Drop ====================

  const handleDragStart = useCallback(
    (_e: DragEvent<HTMLDivElement>, event: CalendarEvent) => {
      draggedEventRef.current = event;
    },
    [],
  );

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const handleDrop = useCallback(
    (_e: DragEvent<HTMLDivElement>, targetDate: Date) => {
      const event = draggedEventRef.current;
      draggedEventRef.current = null;
      if (!event || !datePropertyId) return;
      if (event.isRecurrenceInstance) return; // Don't move recurrence instances
      if (isSameDay(event.startDate, targetDate)) return;

      // Find the definition to get its id
      const def = definitions.find((d) => d.key === datePropertyId);
      if (!def) return;

      const newDateStr = dateKey(targetDate);

      // Use the API to update the property
      messagePropertiesApi
        .setProperty(event.message.id, def.id, newDateStr)
        .catch(() => {
          // silently fail for now; cache will be refreshed
        });
    },
    [datePropertyId, definitions],
  );

  // ==================== Title ====================

  const title = useMemo(() => {
    if (mode === "month") return `${MONTH_NAMES[month]} ${year}`;
    if (mode === "week") {
      const start = weekDays[0].date;
      const end = weekDays[6].date;
      if (start.getMonth() === end.getMonth()) {
        return `${MONTH_NAMES[start.getMonth()]} ${start.getDate()}-${end.getDate()}, ${start.getFullYear()}`;
      }
      return `${MONTH_NAMES[start.getMonth()]} ${start.getDate()} - ${MONTH_NAMES[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
    }
    const d = new Date(year, month, dayOfMonth);
    return `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  }, [mode, month, year, dayOfMonth, weekDays]);

  return (
    <div className="flex flex-col h-full">
      <ViewConfigPanel
        view={view}
        definitions={definitions}
        onUpdateConfig={handleUpdateConfig}
      />

      {/* Calendar toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={goToPrev}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium min-w-[180px] text-center">
            {title}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={goToNext}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={goToToday}
          >
            Today
          </Button>
        </div>

        <div className="flex items-center gap-3">
          <ModeToggle mode={mode} onChange={handleModeChange} />
          <DatePropertySelector
            definitions={definitions}
            selectedId={datePropertyId}
            onChange={handleDatePropertyChange}
          />
        </div>
      </div>

      {/* Calendar content */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : !datePropertyId ? (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
          Select a date property above to display messages on the calendar.
        </div>
      ) : mode === "month" ? (
        <div className="flex-1 overflow-auto p-2">
          {/* Range bars (all-day row) */}
          {rangeEvents.length > 0 && (
            <div className="relative h-5 mb-1">
              {rangeEvents.map((ev, i) => {
                const firstVisibleDay = monthDays[0].date;
                const startOffset = Math.max(
                  0,
                  daysBetween(firstVisibleDay, ev.startDate),
                );
                const endOffset = ev.endDate
                  ? Math.min(41, daysBetween(firstVisibleDay, ev.endDate))
                  : startOffset;
                const startCol = startOffset % 7;
                const spanCols = Math.min(
                  7 - startCol,
                  endOffset - startOffset + 1,
                );
                return (
                  <RangeBar
                    key={`range-${ev.message.id}-${i}`}
                    event={ev}
                    startCol={startCol}
                    spanCols={spanCols}
                  />
                );
              })}
            </div>
          )}

          {/* Day headers */}
          <div className="grid grid-cols-7">
            {DAY_NAMES.map((day) => (
              <div
                key={day}
                className="text-center text-xs font-medium text-muted-foreground py-1.5 border-b border-border"
              >
                {day}
              </div>
            ))}
          </div>

          {/* Date cells */}
          <div className="grid grid-cols-7">
            {monthDays.map((day, i) => (
              <MonthCell
                key={i}
                date={day.date}
                isCurrentMonth={day.isCurrentMonth}
                events={eventsByDate.get(dateKey(day.date)) ?? []}
                onEmptyClick={handleEmptyClick}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onDragStart={handleDragStart}
              />
            ))}
          </div>
        </div>
      ) : mode === "week" ? (
        <WeekView
          days={weekDays}
          eventsByDate={eventsByDate}
          onEmptyClick={handleEmptyClick}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onDragStart={handleDragStart}
        />
      ) : (
        <DayView
          date={new Date(year, month, dayOfMonth)}
          events={
            eventsByDate.get(dateKey(new Date(year, month, dayOfMonth))) ?? []
          }
          onEmptyClick={handleEmptyClick}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onDragStart={handleDragStart}
        />
      )}

      {/* Create event form */}
      {createForm && datePropertyId && (
        <CreateEventForm
          date={createForm.date}
          hour={createForm.hour}
          datePropertyKey={datePropertyId}
          definitions={definitions}
          channelId={channelId}
          onClose={() => setCreateForm(null)}
        />
      )}
    </div>
  );
}

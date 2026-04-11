import { useState, useMemo, useCallback } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useViewMessages } from "@/hooks/useChannelViews";
import { usePropertyDefinitions } from "@/hooks/usePropertyDefinitions";
import { useUpdateView } from "@/hooks/useChannelViews";
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

function getMonthDays(year: number, month: number) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDayOfWeek = firstDay.getDay();
  const daysInMonth = lastDay.getDate();

  const days: { date: Date; isCurrentMonth: boolean }[] = [];

  // Fill leading days from previous month
  const prevMonthLastDay = new Date(year, month, 0).getDate();
  for (let i = startDayOfWeek - 1; i >= 0; i--) {
    days.push({
      date: new Date(year, month - 1, prevMonthLastDay - i),
      isCurrentMonth: false,
    });
  }

  // Current month days
  for (let d = 1; d <= daysInMonth; d++) {
    days.push({ date: new Date(year, month, d), isCurrentMonth: true });
  }

  // Fill trailing days to complete 6 rows (42 cells)
  const remaining = 42 - days.length;
  for (let d = 1; d <= remaining; d++) {
    days.push({
      date: new Date(year, month + 1, d),
      isCurrentMonth: false,
    });
  }

  return days;
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

// ==================== Calendar Cell ====================

function CalendarCell({
  date,
  isCurrentMonth,
  messages,
}: {
  date: Date;
  isCurrentMonth: boolean;
  messages: ViewMessageItem[];
}) {
  const today = isToday(date);

  return (
    <div
      className={cn(
        "border border-border p-1 min-h-[80px] overflow-hidden",
        !isCurrentMonth && "bg-muted/20",
      )}
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
        {messages.length > 0 && (
          <span className="text-[10px] text-muted-foreground">
            {messages.length}
          </span>
        )}
      </div>
      <div className="space-y-0.5">
        {messages.slice(0, 3).map((msg) => {
          const text = msg.content
            ? msg.content.replace(/<[^>]+>/g, "")
            : "...";
          return (
            <div
              key={msg.id}
              className="text-[10px] leading-tight truncate rounded px-1 py-0.5 bg-primary/10 text-foreground cursor-pointer hover:bg-primary/20 transition-colors"
              title={text}
            >
              {text.length > 30 ? text.slice(0, 30) + "..." : text}
            </div>
          );
        })}
        {messages.length > 3 && (
          <div className="text-[10px] text-muted-foreground px-1">
            +{messages.length - 3} more
          </div>
        )}
      </div>
    </div>
  );
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

function getDatePropertyValue(
  message: ViewMessageItem,
  defId: string,
): Date | null {
  const val = message.properties[defId];
  if (!val) return null;

  // Handle date_range: use start date
  if (
    typeof val === "object" &&
    val !== null &&
    "start" in (val as Record<string, unknown>)
  ) {
    const start = (val as Record<string, unknown>).start;
    if (!start) return null;
    const d = new Date(start as string);
    return isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(val as string);
  return isNaN(d.getTime()) ? null : d;
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
            <SelectItem key={d.id} value={d.id} className="text-xs">
              {d.key}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
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

  // Use groupBy field to store the date property for calendar display
  // (This is a simple V1 approach; could use a dedicated config field later)
  const datePropertyId = view.config.groupBy;

  const messages = useMemo(() => extractMessages(messagesData), [messagesData]);

  // Group messages by date
  const messagesByDate = useMemo(() => {
    const map = new Map<string, ViewMessageItem[]>();
    if (!datePropertyId) return map;

    for (const msg of messages) {
      const date = getDatePropertyValue(msg, datePropertyId);
      if (!date) continue;
      const key = dateKey(date);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(msg);
    }
    return map;
  }, [messages, datePropertyId]);

  const days = useMemo(() => getMonthDays(year, month), [year, month]);

  const goToPrevMonth = useCallback(() => {
    if (month === 0) {
      setYear((y) => y - 1);
      setMonth(11);
    } else {
      setMonth((m) => m - 1);
    }
  }, [month]);

  const goToNextMonth = useCallback(() => {
    if (month === 11) {
      setYear((y) => y + 1);
      setMonth(0);
    } else {
      setMonth((m) => m + 1);
    }
  }, [month]);

  const goToToday = useCallback(() => {
    const today = new Date();
    setYear(today.getFullYear());
    setMonth(today.getMonth());
  }, []);

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

  return (
    <div className="flex flex-col h-full">
      <ViewConfigPanel
        view={view}
        definitions={definitions}
        onUpdateConfig={handleUpdateConfig}
      />

      {/* Calendar toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={goToPrevMonth}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium min-w-[140px] text-center">
            {MONTH_NAMES[month]} {year}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={goToNextMonth}
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

        <DatePropertySelector
          definitions={definitions}
          selectedId={datePropertyId}
          onChange={handleDatePropertyChange}
        />
      </div>

      {/* Calendar grid */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : !datePropertyId ? (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
          Select a date property above to display messages on the calendar.
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-2">
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
            {days.map((day, i) => (
              <CalendarCell
                key={i}
                date={day.date}
                isCurrentMonth={day.isCurrentMonth}
                messages={messagesByDate.get(dateKey(day.date)) ?? []}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

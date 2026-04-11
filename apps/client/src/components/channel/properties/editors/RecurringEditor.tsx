import { useCallback, useMemo } from "react";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { PropertyDefinition } from "@/types/properties";

interface RecurringValue {
  frequency: "daily" | "weekly" | "monthly";
  interval: number;
  daysOfWeek?: number[]; // 0=Sun, 1=Mon, ..., 6=Sat
  dayOfMonth?: number;
}

interface RecurringEditorProps {
  definition: PropertyDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
}

const DAYS_OF_WEEK = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
];

function isRecurringValue(v: unknown): v is RecurringValue {
  return (
    typeof v === "object" && v !== null && "frequency" in v && "interval" in v
  );
}

const DEFAULT_RECURRING: RecurringValue = {
  frequency: "daily",
  interval: 1,
};

export function RecurringEditor({
  value,
  onChange,
  disabled,
}: RecurringEditorProps) {
  const recurringVal = useMemo(
    () => (isRecurringValue(value) ? value : DEFAULT_RECURRING),
    [value],
  );

  const handleFrequencyChange = useCallback(
    (freq: string) => {
      const next: RecurringValue = {
        ...recurringVal,
        frequency: freq as RecurringValue["frequency"],
      };
      // Reset sub-fields when frequency changes
      if (freq === "weekly") {
        next.daysOfWeek = next.daysOfWeek || [1]; // default Monday
        delete next.dayOfMonth;
      } else if (freq === "monthly") {
        next.dayOfMonth = next.dayOfMonth || 1;
        delete next.daysOfWeek;
      } else {
        delete next.daysOfWeek;
        delete next.dayOfMonth;
      }
      onChange(next);
    },
    [recurringVal, onChange],
  );

  const handleIntervalChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const num = parseInt(e.target.value, 10);
      if (!isNaN(num) && num > 0) {
        onChange({ ...recurringVal, interval: num });
      }
    },
    [recurringVal, onChange],
  );

  const handleDayOfWeekToggle = useCallback(
    (day: number) => {
      const current = recurringVal.daysOfWeek || [];
      const next = current.includes(day)
        ? current.filter((d) => d !== day)
        : [...current, day].sort();
      // Ensure at least one day is selected
      if (next.length === 0) return;
      onChange({ ...recurringVal, daysOfWeek: next });
    },
    [recurringVal, onChange],
  );

  const handleDayOfMonthChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const num = parseInt(e.target.value, 10);
      if (!isNaN(num) && num >= 1 && num <= 31) {
        onChange({ ...recurringVal, dayOfMonth: num });
      }
    },
    [recurringVal, onChange],
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Every</span>
        <Input
          type="number"
          min={1}
          value={recurringVal.interval}
          onChange={handleIntervalChange}
          disabled={disabled}
          className="w-20"
        />
        <Select
          value={recurringVal.frequency}
          onValueChange={handleFrequencyChange}
          disabled={disabled}
        >
          <SelectTrigger className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="daily">day(s)</SelectItem>
            <SelectItem value="weekly">week(s)</SelectItem>
            <SelectItem value="monthly">month(s)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {recurringVal.frequency === "weekly" && (
        <div className="flex flex-wrap gap-1">
          {DAYS_OF_WEEK.map((day) => {
            const isActive = recurringVal.daysOfWeek?.includes(day.value);
            return (
              <button
                key={day.value}
                type="button"
                onClick={() => handleDayOfWeekToggle(day.value)}
                disabled={disabled}
                className={cn(
                  "h-8 w-10 rounded-md border text-xs font-medium transition-colors",
                  isActive
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input bg-background text-foreground hover:bg-accent",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                )}
              >
                {day.label}
              </button>
            );
          })}
        </div>
      )}

      {recurringVal.frequency === "monthly" && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">on day</span>
          <Input
            type="number"
            min={1}
            max={31}
            value={recurringVal.dayOfMonth || 1}
            onChange={handleDayOfMonthChange}
            disabled={disabled}
            className="w-20"
          />
        </div>
      )}
    </div>
  );
}

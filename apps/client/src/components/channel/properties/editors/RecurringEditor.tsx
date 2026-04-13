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
  freq: "daily" | "weekly" | "monthly";
  interval: number;
  byDay?: string[]; // iCal day abbreviations: "SU", "MO", "TU", "WE", "TH", "FR", "SA"
  byMonthDay?: number[]; // e.g. [1, 15]
  endDate?: string; // ISO date string (optional)
}

interface RecurringEditorProps {
  definition: PropertyDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
}

const DAYS_OF_WEEK = [
  { value: "SU", label: "Sun" },
  { value: "MO", label: "Mon" },
  { value: "TU", label: "Tue" },
  { value: "WE", label: "Wed" },
  { value: "TH", label: "Thu" },
  { value: "FR", label: "Fri" },
  { value: "SA", label: "Sat" },
];

function isRecurringValue(v: unknown): v is RecurringValue {
  return typeof v === "object" && v !== null && "freq" in v && "interval" in v;
}

const DEFAULT_RECURRING: RecurringValue = {
  freq: "daily",
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
    (newFreq: string) => {
      const next: RecurringValue = {
        ...recurringVal,
        freq: newFreq as RecurringValue["freq"],
      };
      // Reset sub-fields when frequency changes
      if (newFreq === "weekly") {
        next.byDay = next.byDay || ["MO"]; // default Monday
        delete next.byMonthDay;
      } else if (newFreq === "monthly") {
        next.byMonthDay = next.byMonthDay || [1];
        delete next.byDay;
      } else {
        delete next.byDay;
        delete next.byMonthDay;
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
    (day: string) => {
      const current = recurringVal.byDay || [];
      const next = current.includes(day)
        ? current.filter((d) => d !== day)
        : [...current, day];
      // Ensure at least one day is selected
      if (next.length === 0) return;
      onChange({ ...recurringVal, byDay: next });
    },
    [recurringVal, onChange],
  );

  const handleDayOfMonthChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const num = parseInt(e.target.value, 10);
      if (!isNaN(num) && num >= 1 && num <= 31) {
        onChange({ ...recurringVal, byMonthDay: [num] });
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
          value={recurringVal.freq}
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

      {recurringVal.freq === "weekly" && (
        <div className="flex flex-wrap gap-1">
          {DAYS_OF_WEEK.map((day) => {
            const isActive = recurringVal.byDay?.includes(day.value);
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

      {recurringVal.freq === "monthly" && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">on day</span>
          <Input
            type="number"
            min={1}
            max={31}
            value={recurringVal.byMonthDay?.[0] || 1}
            onChange={handleDayOfMonthChange}
            disabled={disabled}
            className="w-20"
          />
        </div>
      )}
    </div>
  );
}

import { useCallback } from "react";
import { Calendar } from "lucide-react";

import { Input } from "@/components/ui/input";
import type { PropertyDefinition } from "@/types/properties";

interface DatePickerProps {
  definition: PropertyDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
}

interface DateRangeValue {
  start: string;
  end: string;
}

function isDateRangeValue(v: unknown): v is DateRangeValue {
  return typeof v === "object" && v !== null && "start" in v && "end" in v;
}

function toInputValue(val: unknown, includeTime: boolean): string {
  if (!val || typeof val !== "string") return "";
  if (includeTime) {
    // Convert ISO to datetime-local format (YYYY-MM-DDTHH:mm)
    try {
      const d = new Date(val);
      if (isNaN(d.getTime())) return val;
      return d.toISOString().slice(0, 16);
    } catch {
      return val;
    }
  }
  // Date only: take first 10 chars (YYYY-MM-DD)
  return val.slice(0, 10);
}

function fromInputValue(raw: string, includeTime: boolean): string {
  if (!raw) return "";
  if (includeTime) {
    // datetime-local gives YYYY-MM-DDTHH:mm, convert to ISO
    try {
      return new Date(raw).toISOString();
    } catch {
      return raw;
    }
  }
  return raw; // YYYY-MM-DD
}

function SingleDateEditor({
  definition,
  value,
  onChange,
  disabled,
}: DatePickerProps) {
  const includeTime =
    definition.valueType === "timestamp" ||
    definition.valueType === "timestamp_range";
  const inputType = includeTime ? "datetime-local" : "date";

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      if (!raw) {
        onChange(null);
        return;
      }
      onChange(fromInputValue(raw, includeTime));
    },
    [onChange, includeTime],
  );

  return (
    <div className="flex items-center gap-1.5">
      <Calendar className="h-4 w-4 shrink-0 text-muted-foreground" />
      <Input
        type={inputType}
        value={toInputValue(value, includeTime)}
        onChange={handleChange}
        disabled={disabled}
      />
    </div>
  );
}

function DateRangeEditor({
  definition,
  value,
  onChange,
  disabled,
}: DatePickerProps) {
  const includeTime = definition.valueType === "timestamp_range";
  const inputType = includeTime ? "datetime-local" : "date";

  const rangeVal = isDateRangeValue(value) ? value : { start: "", end: "" };

  const handleStartChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      onChange({
        start: raw ? fromInputValue(raw, includeTime) : "",
        end: rangeVal.end,
      });
    },
    [onChange, includeTime, rangeVal.end],
  );

  const handleEndChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      onChange({
        start: rangeVal.start,
        end: raw ? fromInputValue(raw, includeTime) : "",
      });
    },
    [onChange, includeTime, rangeVal.start],
  );

  return (
    <div className="flex items-center gap-2">
      <Calendar className="h-4 w-4 shrink-0 text-muted-foreground" />
      <Input
        type={inputType}
        value={toInputValue(rangeVal.start, includeTime)}
        onChange={handleStartChange}
        disabled={disabled}
        className="flex-1"
      />
      <span className="text-sm text-muted-foreground">to</span>
      <Input
        type={inputType}
        value={toInputValue(rangeVal.end, includeTime)}
        onChange={handleEndChange}
        disabled={disabled}
        className="flex-1"
      />
    </div>
  );
}

export function DatePicker(props: DatePickerProps) {
  const { valueType } = props.definition;

  if (valueType === "date_range" || valueType === "timestamp_range") {
    return <DateRangeEditor {...props} />;
  }

  return <SingleDateEditor {...props} />;
}

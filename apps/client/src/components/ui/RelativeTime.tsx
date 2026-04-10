import { useState, useEffect, useCallback } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatRelative, formatDateTime } from "@/lib/date-format";

interface RelativeTimeProps {
  date: Date | string | number;
  className?: string;
}

export function getUpdateInterval(date: Date): number {
  const diffMs = Date.now() - date.getTime();
  const diffMin = diffMs / 60_000;
  if (diffMin < 60) return 30_000;
  if (diffMin < 1440) return 60_000;
  return 0;
}

export function RelativeTime({ date, className }: RelativeTimeProps) {
  const dateObj = date instanceof Date ? date : new Date(date);
  const dateMs = dateObj.getTime();
  const [showAbsolute, setShowAbsolute] = useState(false);
  const [, setTick] = useState(0);

  const forceUpdate = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    const interval = getUpdateInterval(new Date(dateMs));
    if (interval === 0) return;
    const id = setInterval(forceUpdate, interval);
    return () => clearInterval(id);
  }, [dateMs, forceUpdate]);

  const absoluteText = formatDateTime(dateObj);
  const relativeText = formatRelative(dateObj);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={className}
          role="button"
          tabIndex={0}
          onClick={() => setShowAbsolute((v) => !v)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              setShowAbsolute((v) => !v);
            }
          }}
        >
          {showAbsolute ? absoluteText : relativeText}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {showAbsolute ? relativeText : absoluteText}
      </TooltipContent>
    </Tooltip>
  );
}

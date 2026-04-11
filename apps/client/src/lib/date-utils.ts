import {
  formatRelative as _formatRelative,
  formatDateGroup as _formatDateGroup,
} from "@/lib/date-format";

const ISO_DATETIME_WITHOUT_TZ_RE =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;
const EXPLICIT_TIMEZONE_SUFFIX_RE = /(?:[zZ]|[+-]\d{2}:\d{2})$/;

/**
 * Parse API timestamps consistently.
 * Bare datetime strings without an explicit timezone are treated as UTC.
 */
export function parseApiDate(value: Date | string | number): Date {
  if (value instanceof Date) {
    return new Date(value.getTime());
  }

  if (typeof value === "number") {
    return new Date(value);
  }

  const trimmed = value.trim();
  if (
    ISO_DATETIME_WITHOUT_TZ_RE.test(trimmed) &&
    !EXPLICIT_TIMEZONE_SUFFIX_RE.test(trimmed)
  ) {
    return new Date(`${trimmed.replace(" ", "T")}Z`);
  }

  return new Date(trimmed);
}

/**
 * Heuristic parser for timestamps that should represent a past event.
 * Useful for relative timers when upstream payloads may be serialized with or
 * without timezone information inconsistently.
 */
export function parseLikelyPastDate(
  value: Date | string | number,
  referenceTime: number = Date.now(),
): Date {
  if (value instanceof Date || typeof value === "number") {
    return parseApiDate(value);
  }

  const trimmed = value.trim();
  const candidates = new Set<number>();

  const direct = new Date(trimmed).getTime();
  if (!Number.isNaN(direct)) {
    candidates.add(direct);
  }

  if (EXPLICIT_TIMEZONE_SUFFIX_RE.test(trimmed)) {
    const localLike = trimmed.replace(EXPLICIT_TIMEZONE_SUFFIX_RE, "");
    const localTime = new Date(localLike).getTime();
    if (!Number.isNaN(localTime)) {
      candidates.add(localTime);
    }
  } else if (ISO_DATETIME_WITHOUT_TZ_RE.test(trimmed)) {
    const utcTime = new Date(`${trimmed.replace(" ", "T")}Z`).getTime();
    if (!Number.isNaN(utcTime)) {
      candidates.add(utcTime);
    }
  }

  if (candidates.size === 0) {
    return new Date(NaN);
  }

  const sorted = Array.from(candidates).sort((a, b) => a - b);
  const pastOrNearNow = sorted.filter((time) => time <= referenceTime + 60_000);
  const best =
    pastOrNearNow.length > 0
      ? pastOrNearNow[pastOrNearNow.length - 1]
      : sorted.reduce((closest, time) =>
          Math.abs(time - referenceTime) < Math.abs(closest - referenceTime)
            ? time
            : closest,
        );

  return new Date(best);
}

/**
 * Format a date as static time (e.g., "10:30" for today, "01/05 10:30" for other days)
 */
export function formatMessageTime(date: Date): string {
  const now = new Date();
  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const time = `${hours}:${minutes}`;

  if (isToday) {
    return time;
  }

  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");

  // If same year, show MM/DD HH:mm
  if (date.getFullYear() === now.getFullYear()) {
    return `${month}/${day} ${time}`;
  }

  // Different year, show YYYY/MM/DD HH:mm
  return `${date.getFullYear()}/${month}/${day} ${time}`;
}

/**
 * Format a date as relative time (e.g., "2 hours ago").
 * Delegates to the locale-aware `formatRelative` from `date-format.ts`.
 */
export const formatDistanceToNow = _formatRelative;

/**
 * Format a date for grouping headers (e.g., "Today", "Yesterday", "Jan 13, Monday").
 * Delegates to the locale-aware `formatDateGroup` from `date-format.ts`.
 *
 * @deprecated The `locale` parameter is ignored — the current i18n locale is used instead.
 */
export const formatDateGroup = _formatDateGroup;

/**
 * Get the date key for grouping (YYYY-MM-DD format)
 */
export function getDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Group items by date.
 *
 * @deprecated The `locale` parameter is accepted for backward compatibility but ignored.
 * The current i18n locale is used automatically via `formatDateGroup`.
 */
export function groupByDate<T>(
  items: T[],
  getDate: (item: T) => Date,
  _locale?: string,
): Array<{ dateKey: string; dateLabel: string; items: T[] }> {
  const groups = new Map<string, { dateLabel: string; items: T[] }>();

  for (const item of items) {
    const date = getDate(item);
    const dateKey = getDateKey(date);

    if (!groups.has(dateKey)) {
      groups.set(dateKey, {
        dateLabel: _formatDateGroup(date),
        items: [],
      });
    }
    groups.get(dateKey)!.items.push(item);
  }

  // Convert to array and sort by date (newest first)
  return Array.from(groups.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([dateKey, { dateLabel, items }]) => ({
      dateKey,
      dateLabel,
      items,
    }));
}

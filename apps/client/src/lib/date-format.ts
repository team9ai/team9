import i18n from "@/i18n";

const localeMap: Record<string, string> = {
  en: "en-US",
  "zh-CN": "zh-CN",
  "zh-TW": "zh-TW",
  ja: "ja-JP",
  ko: "ko-KR",
  es: "es-ES",
  fr: "fr-FR",
  de: "de-DE",
};

export function getCurrentLocale(): string {
  return localeMap[i18n.language] || "en-US";
}

function toDate(value: Date | string | number): Date {
  if (value instanceof Date) return value;
  return new Date(value);
}

export function formatDate(
  value: Date | string | number,
  options?: Intl.DateTimeFormatOptions,
): string {
  const date = toDate(value);
  const opts: Intl.DateTimeFormatOptions = options ?? {
    year: "numeric",
    month: "long",
    day: "numeric",
  };
  return new Intl.DateTimeFormat(getCurrentLocale(), opts).format(date);
}

export function formatTime(
  value: Date | string | number,
  options?: Intl.DateTimeFormatOptions,
): string {
  const date = toDate(value);
  const opts: Intl.DateTimeFormatOptions = options ?? {
    hour: "2-digit",
    minute: "2-digit",
  };
  return new Intl.DateTimeFormat(getCurrentLocale(), opts).format(date);
}

export function formatDateTime(
  value: Date | string | number,
  options?: Intl.DateTimeFormatOptions,
): string {
  const date = toDate(value);
  const opts: Intl.DateTimeFormatOptions = options ?? {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  };
  return new Intl.DateTimeFormat(getCurrentLocale(), opts).format(date);
}

/**
 * Slack-style absolute tooltip: locale-aware month/day + 12h time with
 * AM/PM + seconds. Year is omitted when the target is in the current
 * year to keep the bubble compact.
 */
export function formatAbsoluteTooltip(value: Date | string | number): string {
  const date = toDate(value);
  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();
  const opts: Intl.DateTimeFormatOptions = {
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  };
  if (!sameYear) opts.year = "numeric";
  return new Intl.DateTimeFormat(getCurrentLocale(), opts).format(date);
}

export function formatRelative(value: Date | string | number): string {
  const date = toDate(value);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) {
    return i18n.t("common:justNow");
  }

  const locale = getCurrentLocale();
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return rtf.format(-diffMin, "minute");

  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return rtf.format(-diffHours, "hour");

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return rtf.format(-diffDays, "day");

  return formatDate(date);
}

export function formatNumber(
  num: number,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(getCurrentLocale(), options).format(num);
}

export function formatDateGroup(date: Date): string {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (sameDay(date, now)) return i18n.t("common:today");
  if (sameDay(date, yesterday)) return i18n.t("common:yesterday");

  return new Intl.DateTimeFormat(getCurrentLocale(), {
    month: "short",
    day: "numeric",
    weekday: "long",
  }).format(date);
}

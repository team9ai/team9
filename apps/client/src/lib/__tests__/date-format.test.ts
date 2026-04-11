import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({
  default: {
    language: "en",
    t: (key: string) => {
      const map: Record<string, string> = {
        "common:justNow": "just now",
        "common:today": "Today",
        "common:yesterday": "Yesterday",
      };
      return map[key] ?? key;
    },
  },
}));

import {
  formatDate,
  formatDateGroup,
  formatDateTime,
  formatNumber,
  formatRelative,
  formatTime,
  getCurrentLocale,
} from "../date-format";
import i18n from "@/i18n";

describe("getCurrentLocale", () => {
  afterEach(() => {
    (i18n as { language: string }).language = "en";
  });

  it('returns "en-US" for "en"', () => {
    expect(getCurrentLocale()).toBe("en-US");
  });

  it('returns "zh-CN" for "zh-CN"', () => {
    (i18n as { language: string }).language = "zh-CN";
    expect(getCurrentLocale()).toBe("zh-CN");
  });

  it('returns "ja-JP" for "ja"', () => {
    (i18n as { language: string }).language = "ja";
    expect(getCurrentLocale()).toBe("ja-JP");
  });

  it('falls back to "en-US" for unknown languages', () => {
    (i18n as { language: string }).language = "xx";
    expect(getCurrentLocale()).toBe("en-US");
  });
});

describe("formatDate", () => {
  it("produces a date string containing year, month, and day info", () => {
    const result = formatDate(new Date(2026, 0, 15));
    expect(result).toContain("2026");
    expect(result).toContain("January");
    expect(result).toContain("15");
  });

  it("accepts a string input", () => {
    const result = formatDate("2026-06-01T00:00:00Z");
    expect(result).toBeTruthy();
  });

  it("accepts a number (timestamp) input", () => {
    const result = formatDate(Date.UTC(2026, 5, 1));
    expect(result).toBeTruthy();
  });

  it("uses custom options when provided", () => {
    const result = formatDate(new Date(2026, 0, 15), {
      year: "2-digit",
      month: "2-digit",
      day: "2-digit",
    });
    expect(result).toContain("26");
  });
});

describe("formatTime", () => {
  it("produces a time string with hours and minutes", () => {
    const result = formatTime(new Date(2026, 0, 15, 14, 30));
    // Should contain "2:30" or "02:30" depending on locale
    expect(result).toMatch(/2:30/);
  });

  it("uses custom options when provided", () => {
    const result = formatTime(new Date(2026, 0, 15, 14, 30, 45), {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    expect(result).toMatch(/45/);
  });
});

describe("formatDateTime", () => {
  it("produces a string with both date and time info", () => {
    const result = formatDateTime(new Date(2026, 0, 15, 14, 30));
    expect(result).toContain("2026");
    expect(result).toContain("January");
    expect(result).toContain("15");
    expect(result).toMatch(/2:30/);
  });

  it("uses custom options when provided", () => {
    const result = formatDateTime(new Date(2026, 0, 15, 14, 30), {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    expect(result).toContain("Jan");
  });
});

describe("formatRelative", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-10T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "just now" for less than 60 seconds ago', () => {
    const date = new Date(Date.now() - 30 * 1000);
    expect(formatRelative(date)).toBe("just now");
  });

  it('returns "just now" for exactly 0 seconds ago', () => {
    expect(formatRelative(new Date())).toBe("just now");
  });

  it("returns minutes string for less than 1 hour ago", () => {
    const date = new Date(Date.now() - 5 * 60 * 1000);
    const result = formatRelative(date);
    expect(result).toMatch(/5\s*minutes?\s*ago/i);
  });

  it("returns hours string for less than 24 hours ago", () => {
    const date = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const result = formatRelative(date);
    expect(result).toMatch(/3\s*hours?\s*ago/i);
  });

  it("returns days string for less than 7 days ago", () => {
    const date = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const result = formatRelative(date);
    expect(result).toMatch(/2\s*days?\s*ago/i);
  });

  it("returns formatted date for 7 or more days ago", () => {
    const date = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const result = formatRelative(date);
    // Should fall back to formatDate, containing "March" and "2026"
    expect(result).toContain("March");
    expect(result).toContain("2026");
  });

  it("returns formatted date for very old dates", () => {
    const date = new Date("2020-01-01T00:00:00Z");
    const result = formatRelative(date);
    expect(result).toContain("2020");
  });

  it("accepts string input", () => {
    const result = formatRelative(
      new Date(Date.now() - 10 * 1000).toISOString(),
    );
    expect(result).toBe("just now");
  });

  it("accepts number input", () => {
    const result = formatRelative(Date.now() - 10 * 1000);
    expect(result).toBe("just now");
  });
});

describe("formatNumber", () => {
  it("formats numbers with locale separators", () => {
    const result = formatNumber(1234567.89);
    // en-US uses comma as thousands separator
    expect(result).toContain("1,234,567");
  });

  it("formats zero", () => {
    expect(formatNumber(0)).toBe("0");
  });

  it("formats negative numbers", () => {
    const result = formatNumber(-1234);
    expect(result).toMatch(/-1,234/);
  });

  it("uses custom options when provided", () => {
    const result = formatNumber(0.5, { style: "percent" });
    expect(result).toBe("50%");
  });

  it("uses currency options", () => {
    const result = formatNumber(42.5, {
      style: "currency",
      currency: "USD",
    });
    expect(result).toContain("$");
    expect(result).toContain("42.50");
  });
});

describe("formatDateGroup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-10T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "Today" for today\'s date', () => {
    const today = new Date();
    expect(formatDateGroup(today)).toBe("Today");
  });

  it('returns "Today" for earlier today', () => {
    const earlier = new Date("2026-04-10T02:00:00Z");
    expect(formatDateGroup(earlier)).toBe("Today");
  });

  it('returns "Yesterday" for yesterday\'s date', () => {
    const yesterday = new Date("2026-04-09T15:00:00Z");
    expect(formatDateGroup(yesterday)).toBe("Yesterday");
  });

  it("returns formatted date with weekday for older dates", () => {
    const oldDate = new Date("2026-03-15T12:00:00Z");
    const result = formatDateGroup(oldDate);
    // Should contain weekday, month, and day
    expect(result).toContain("Sunday");
    expect(result).toContain("Mar");
    expect(result).toContain("15");
  });

  it("returns formatted date for dates from a different year", () => {
    const oldDate = new Date("2025-12-25T12:00:00Z");
    const result = formatDateGroup(oldDate);
    expect(result).toContain("Dec");
    expect(result).toContain("25");
  });
});

import { describe, expect, it } from "vitest";
import { parseApiDate, parseLikelyPastDate } from "../date-utils";

describe("parseApiDate", () => {
  it("treats bare ISO datetimes as UTC", () => {
    expect(parseApiDate("2026-03-27T17:42:00.000").toISOString()).toBe(
      "2026-03-27T17:42:00.000Z",
    );
  });

  it("preserves explicit UTC timestamps", () => {
    expect(parseApiDate("2026-03-27T17:42:00.000Z").toISOString()).toBe(
      "2026-03-27T17:42:00.000Z",
    );
  });

  it("supports space-separated datetimes from APIs", () => {
    expect(parseApiDate("2026-03-27 17:42:00.000").toISOString()).toBe(
      "2026-03-27T17:42:00.000Z",
    );
  });
});

describe("parseLikelyPastDate", () => {
  it("prefers the candidate that is not still in the future", () => {
    const raw = "2026-03-28T01:42:00.000Z";
    const localCandidate = new Date("2026-03-28T01:42:00.000").getTime();
    const utcCandidate = new Date(raw).getTime();
    const earlierCandidate = Math.min(localCandidate, utcCandidate);
    const laterCandidate = Math.max(localCandidate, utcCandidate);
    const candidateGap = laterCandidate - earlierCandidate;
    const referenceTime =
      candidateGap > 60_000
        ? earlierCandidate + Math.floor(candidateGap / 2)
        : earlierCandidate;
    const expected = candidateGap > 60_000 ? earlierCandidate : laterCandidate;

    expect(parseLikelyPastDate(raw, referenceTime).getTime()).toBe(expected);
  });

  it("falls back to the closest candidate when both interpretations are still in the future", () => {
    const raw = "2026-03-28T01:42:00.000";
    const localCandidate = new Date(raw).getTime();
    const utcCandidate = new Date(`${raw}Z`).getTime();
    const referenceTime = Math.min(localCandidate, utcCandidate) - 10 * 60_000;
    const expected =
      Math.abs(localCandidate - referenceTime) <
      Math.abs(utcCandidate - referenceTime)
        ? localCandidate
        : utcCandidate;

    expect(parseLikelyPastDate(raw, referenceTime).getTime()).toBe(expected);
  });
});

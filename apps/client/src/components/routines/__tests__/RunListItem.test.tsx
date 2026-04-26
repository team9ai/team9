import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown> | string) => {
      if (typeof opts === "string") return opts;
      const fallback = opts?.defaultValue as string | undefined;
      return fallback ?? key;
    },
  }),
}));

vi.mock("@/lib/date-format", () => ({
  formatDateTime: (s: string) => `formatted:${s}`,
}));

import { RunListItem } from "../RunListItem";
import type { RoutineExecution } from "@/types/routine";

const baseExecution: RoutineExecution = {
  id: "e1",
  routineId: "r1",
  routineVersion: 3,
  status: "completed",
  channelId: null,
  taskcastTaskId: null,
  tokenUsage: 0,
  triggerId: null,
  triggerType: null,
  triggerContext: null,
  documentVersionId: null,
  sourceExecutionId: null,
  startedAt: "2026-04-26T10:00:00Z",
  completedAt: "2026-04-26T10:03:24Z",
  duration: 204,
  error: null,
  createdAt: "2026-04-26T10:00:00Z",
};

const fixedNow = new Date("2026-04-26T10:05:00Z").getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(fixedNow);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("RunListItem", () => {
  it("renders version, formatted time, token, duration", () => {
    render(
      <RunListItem
        execution={{ ...baseExecution, tokenUsage: 1200 }}
        isSelected={false}
        onClick={() => {}}
      />,
    );
    expect(screen.getByText("v3")).toBeInTheDocument();
    expect(screen.getByText(/formatted:2026-04-26/)).toBeInTheDocument();
    expect(screen.getByText("1200 tokens")).toBeInTheDocument();
    expect(screen.getByText("3m 24s")).toBeInTheDocument();
  });

  it("hides token when tokenUsage is 0", () => {
    render(
      <RunListItem
        execution={baseExecution}
        isSelected={false}
        onClick={() => {}}
      />,
    );
    expect(screen.queryByText(/tokens/)).toBeNull();
  });

  it.each([
    ["manual", "Manual"],
    ["schedule", "Scheduled"],
    ["interval", "Interval"],
    ["channel_message", "Channel"],
  ] as const)(
    "renders trigger badge for triggerType=%s",
    (triggerType, label) => {
      render(
        <RunListItem
          execution={{ ...baseExecution, triggerType }}
          isSelected={false}
          onClick={() => {}}
        />,
      );
      expect(screen.getByText(label)).toBeInTheDocument();
    },
  );

  it("renders Retry badge when triggerContext has originalExecutionId", () => {
    render(
      <RunListItem
        execution={{
          ...baseExecution,
          triggerType: "manual",
          triggerContext: {
            triggeredAt: "2026-04-26T10:00:00Z",
            triggeredBy: "u1",
            originalExecutionId: "e0",
          },
        }}
        isSelected={false}
        onClick={() => {}}
      />,
    );
    expect(screen.getByText("Retry")).toBeInTheDocument();
    expect(screen.queryByText("Manual")).toBeNull();
  });

  it("renders no badge when triggerType is null and not retry", () => {
    render(
      <RunListItem
        execution={baseExecution}
        isSelected={false}
        onClick={() => {}}
      />,
    );
    ["Manual", "Scheduled", "Interval", "Channel", "Retry"].forEach((label) => {
      expect(screen.queryByText(label)).toBeNull();
    });
  });

  it("renders running prefix for in-progress runs", () => {
    render(
      <RunListItem
        execution={{
          ...baseExecution,
          status: "in_progress",
          completedAt: null,
          duration: null,
        }}
        isSelected={false}
        onClick={() => {}}
      />,
    );
    expect(screen.getByText("running 5m 0s+")).toBeInTheDocument();
  });

  it("hides duration when startedAt is null", () => {
    const { container } = render(
      <RunListItem
        execution={{ ...baseExecution, startedAt: null, completedAt: null }}
        isSelected={false}
        onClick={() => {}}
      />,
    );
    expect(container.querySelector(".pl-4")).toBeNull();
  });

  it("applies selected styling and fires onClick", () => {
    const onClick = vi.fn();
    const { container } = render(
      <RunListItem
        execution={baseExecution}
        isSelected={true}
        onClick={onClick}
      />,
    );
    const btn = container.querySelector("button");
    expect(btn?.className).toMatch(/primary|ring/);
    fireEvent.click(btn!);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

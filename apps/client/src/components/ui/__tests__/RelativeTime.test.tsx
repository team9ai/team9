import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { RelativeTime, getUpdateInterval } from "../RelativeTime";

vi.mock("@/lib/date-format", () => ({
  formatRelative: vi.fn(() => "5 minutes ago"),
  formatDateTime: vi.fn(() => "April 10, 2026, 2:30 PM"),
}));

function renderWithTooltip(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

describe("RelativeTime", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-04-10T14:35:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders relative time by default", () => {
    renderWithTooltip(<RelativeTime date={new Date("2026-04-10T14:30:00Z")} />);

    expect(screen.getByText("5 minutes ago")).toBeInTheDocument();
  });

  it("toggles to absolute time on click", () => {
    renderWithTooltip(<RelativeTime date={new Date("2026-04-10T14:30:00Z")} />);

    fireEvent.click(screen.getByRole("button"));

    expect(screen.getByText("April 10, 2026, 2:30 PM")).toBeInTheDocument();
  });

  it("toggles back to relative on second click", () => {
    renderWithTooltip(<RelativeTime date={new Date("2026-04-10T14:30:00Z")} />);

    const button = screen.getByRole("button");
    fireEvent.click(button);
    fireEvent.click(button);

    expect(screen.getByText("5 minutes ago")).toBeInTheDocument();
  });

  it("toggles on Enter key press", () => {
    renderWithTooltip(<RelativeTime date={new Date("2026-04-10T14:30:00Z")} />);

    const button = screen.getByRole("button");
    fireEvent.keyDown(button, { key: "Enter" });

    expect(screen.getByText("April 10, 2026, 2:30 PM")).toBeInTheDocument();
  });

  it("toggles on Space key press", () => {
    renderWithTooltip(<RelativeTime date={new Date("2026-04-10T14:30:00Z")} />);

    const button = screen.getByRole("button");
    fireEvent.keyDown(button, { key: " " });

    expect(screen.getByText("April 10, 2026, 2:30 PM")).toBeInTheDocument();
  });

  it("does not toggle on unrelated key press", () => {
    renderWithTooltip(<RelativeTime date={new Date("2026-04-10T14:30:00Z")} />);

    const button = screen.getByRole("button");
    fireEvent.keyDown(button, { key: "Tab" });

    expect(screen.getByText("5 minutes ago")).toBeInTheDocument();
  });

  it("accepts a string date", () => {
    renderWithTooltip(<RelativeTime date="2026-04-10T14:30:00Z" />);

    expect(screen.getByText("5 minutes ago")).toBeInTheDocument();
  });

  it("accepts a numeric timestamp", () => {
    renderWithTooltip(
      <RelativeTime date={new Date("2026-04-10T14:30:00Z").getTime()} />,
    );

    expect(screen.getByText("5 minutes ago")).toBeInTheDocument();
  });

  it("does not set up auto-update interval for dates older than 24 hours", () => {
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");

    renderWithTooltip(<RelativeTime date={new Date("2026-04-08T14:00:00Z")} />);

    // setInterval should not have been called for our component
    // (no interval registered when getUpdateInterval returns 0)
    const callsWithOurInterval = setIntervalSpy.mock.calls.filter(
      ([, ms]) => ms === 30_000 || ms === 60_000,
    );
    expect(callsWithOurInterval).toHaveLength(0);

    setIntervalSpy.mockRestore();
  });

  it("auto-updates via interval tick", async () => {
    renderWithTooltip(<RelativeTime date={new Date("2026-04-10T14:30:00Z")} />);

    // The component should re-render after the 30s interval fires
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });

    // Still renders (formatRelative is mocked, so content unchanged, but no crash)
    expect(screen.getByRole("button")).toHaveTextContent("5 minutes ago");
  });

  it("clears interval on unmount", () => {
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");

    const { unmount } = renderWithTooltip(
      <RelativeTime date={new Date("2026-04-10T14:30:00Z")} />,
    );

    const callsBefore = clearIntervalSpy.mock.calls.length;
    unmount();
    expect(clearIntervalSpy.mock.calls.length).toBeGreaterThan(callsBefore);

    clearIntervalSpy.mockRestore();
  });

  it("sets up 30s auto-update interval for recent dates", () => {
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");

    renderWithTooltip(<RelativeTime date={new Date("2026-04-10T14:30:00Z")} />);

    const callsWithInterval = setIntervalSpy.mock.calls.filter(
      ([, ms]) => ms === 30_000,
    );
    expect(callsWithInterval).toHaveLength(1);

    setIntervalSpy.mockRestore();
  });

  it("applies the className prop", () => {
    renderWithTooltip(
      <RelativeTime
        date={new Date("2026-04-10T14:30:00Z")}
        className="text-muted"
      />,
    );

    expect(screen.getByRole("button")).toHaveClass("text-muted");
  });

  it("tooltip shows absolute time when displaying relative", async () => {
    renderWithTooltip(<RelativeTime date={new Date("2026-04-10T14:30:00Z")} />);

    const button = screen.getByRole("button");

    // Trigger text should be relative
    expect(button).toHaveTextContent("5 minutes ago");

    // Focus to open tooltip (Radix supports keyboard-triggered tooltip)
    await act(async () => {
      fireEvent.focus(button);
      vi.advanceTimersByTime(1000);
    });

    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "April 10, 2026, 2:30 PM",
    );
  });

  it("tooltip shows relative time when displaying absolute", async () => {
    renderWithTooltip(<RelativeTime date={new Date("2026-04-10T14:30:00Z")} />);

    const button = screen.getByRole("button");
    fireEvent.click(button);

    expect(button).toHaveTextContent("April 10, 2026, 2:30 PM");

    await act(async () => {
      fireEvent.focus(button);
      vi.advanceTimersByTime(1000);
    });

    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "5 minutes ago",
    );
  });
});

describe("getUpdateInterval", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-10T14:35:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 30_000 for dates less than 1 hour ago", () => {
    const date = new Date("2026-04-10T14:30:00Z"); // 5 min ago
    expect(getUpdateInterval(date)).toBe(30_000);
  });

  it("returns 60_000 for dates between 1 hour and 24 hours ago", () => {
    const date = new Date("2026-04-10T12:00:00Z"); // ~2.5 hours ago
    expect(getUpdateInterval(date)).toBe(60_000);
  });

  it("returns 3_600_000 for dates more than 24 hours but less than 7 days ago", () => {
    const date = new Date("2026-04-08T14:00:00Z"); // ~2 days ago
    expect(getUpdateInterval(date)).toBe(3_600_000);
  });

  it("returns 30_000 for dates just under 60 minutes ago", () => {
    const date = new Date("2026-04-10T13:36:00Z"); // 59 min ago
    expect(getUpdateInterval(date)).toBe(30_000);
  });

  it("returns 60_000 for dates exactly 60 minutes ago", () => {
    const date = new Date("2026-04-10T13:35:00Z"); // 60 min ago
    expect(getUpdateInterval(date)).toBe(60_000);
  });

  it("returns 60_000 for dates just under 24 hours ago", () => {
    const date = new Date("2026-04-09T14:36:00Z"); // 23h59m ago
    expect(getUpdateInterval(date)).toBe(60_000);
  });

  it("returns 3_600_000 for dates exactly 24 hours ago", () => {
    const date = new Date("2026-04-09T14:35:00Z"); // 24h ago
    expect(getUpdateInterval(date)).toBe(3_600_000);
  });

  it("returns 0 for dates more than 7 days ago", () => {
    const date = new Date("2026-04-02T14:00:00Z"); // ~8 days ago
    expect(getUpdateInterval(date)).toBe(0);
  });
});

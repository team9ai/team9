import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockNavigate = vi.hoisted(() => vi.fn());
const routeState = vi.hoisted(() => ({
  pathname: "/tasks/new-conversation",
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      (
        ({
          home: "Home",
          workspace: "Workspace",
          dms: "DMs",
          activity: "Activity",
          staff: "Staff",
          routines: "Routines",
          tasks: "Tasks",
          skills: "Skills",
          resources: "Resources",
          wiki: "Library",
          application: "Apps",
          more: "More",
        }) as Record<string, string>
      )[key] ?? key,
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  useLocation: () => routeState,
  useNavigate: () => mockNavigate,
}));

vi.mock("@/hooks/useNotifications", () => ({
  useNotificationCounts: () => ({ data: { total: 0, byType: {} } }),
}));

vi.mock("@/hooks/useChannels", () => ({
  useChannelsByType: () => ({ directChannels: [] }),
}));

vi.mock("@/components/ui/badge", () => ({
  NotificationBadge: () => null,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    className,
    onClick,
    title,
  }: {
    children: React.ReactNode;
    className?: string;
    onClick?: () => void;
    title?: string;
  }) => (
    <button type="button" className={className} onClick={onClick} title={title}>
      {children}
    </button>
  ),
}));

import { navigationItems, NavigationRail } from "../NavigationRail";

describe("NavigationRail task entry", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    routeState.pathname = "/tasks/new-conversation";
    localStorage.clear();
  });

  it("shows Workspace in the default rail and hides DMs before unlock", () => {
    expect(
      navigationItems.find((item) => item.id === "workspace")?.labelKey,
    ).toBe("workspace");
    expect(
      navigationItems.find((item) => item.id === "routines")?.labelKey,
    ).toBe("routines");
    expect(navigationItems.find((item) => item.id === "tasks")).toBeUndefined();

    render(<NavigationRail />);

    expect(
      screen
        .getAllByRole("button")
        .map((button) => button.getAttribute("title")),
    ).toEqual([
      "Home",
      "Workspace",
      "Activity",
      "Staff",
      "Routines",
      "Skills",
      "Apps",
      "More",
    ]);
    expect(screen.queryByTitle("DMs")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Tasks")).not.toBeInTheDocument();
  });

  it("highlights Home on the task new conversation route", () => {
    render(<NavigationRail />);

    expect(screen.getByTitle("Home")).toHaveClass("bg-nav-active");
  });

  it("uses the task new conversation view as the Home destination", () => {
    render(<NavigationRail />);

    fireEvent.click(screen.getByTitle("Home"));

    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/tasks/new-conversation",
    });
  });
});

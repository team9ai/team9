import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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
  useLocation: () => ({ pathname: "/tasks" }),
  useNavigate: () => vi.fn(),
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
  it("shows Workspace in the default rail and hides DMs before unlock", () => {
    expect(
      navigationItems.find((item) => item.id === "workspace")?.labelKey,
    ).toBe("workspace");
    expect(
      navigationItems.find((item) => item.id === "routines")?.labelKey,
    ).toBe("routines");
    expect(navigationItems.find((item) => item.id === "tasks")?.labelKey).toBe(
      "tasks",
    );

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
      "Tasks",
      "Routines",
      "Skills",
      "Apps",
      "More",
    ]);
    expect(screen.queryByTitle("DMs")).not.toBeInTheDocument();
  });
});

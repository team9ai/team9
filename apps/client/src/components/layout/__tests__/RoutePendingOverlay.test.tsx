import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RoutePendingOverlay } from "../RoutePendingOverlay";

type RouterState = {
  status: "idle" | "pending";
  location: { href: string };
  resolvedLocation?: { href: string };
};

let routerState: RouterState;

vi.mock("@tanstack/react-router", () => ({
  useRouterState: ({ select }: { select: (state: RouterState) => unknown }) =>
    select(routerState),
}));

describe("RoutePendingOverlay", () => {
  beforeEach(() => {
    routerState = {
      status: "idle",
      location: { href: "/channels" },
      resolvedLocation: { href: "/channels" },
    };
  });

  it("does not cover the page while the current route is idle", () => {
    render(<RoutePendingOverlay />);

    expect(screen.queryByTestId("route-pending-overlay")).toBeNull();
  });

  it("covers stale outlet content while a different route is pending", () => {
    routerState = {
      status: "pending",
      location: { href: "/wiki" },
      resolvedLocation: { href: "/channels" },
    };

    render(<RoutePendingOverlay />);

    expect(screen.getByTestId("route-pending-overlay")).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(
      document.querySelector(".route-pending-skeleton"),
    ).toBeInTheDocument();
  });
});

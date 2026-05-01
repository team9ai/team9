import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SUB_SIDEBAR_WIDTH_DEFAULT,
  SUB_SIDEBAR_WIDTH_MAX,
  useAppStore,
} from "@/stores";
import { DynamicSubSidebar } from "../DynamicSubSidebar";

let pathname = "/wiki";

vi.mock("@tanstack/react-router", () => ({
  useLocation: () => ({ pathname }),
}));

vi.mock("../sidebars/HomeSubSidebar", () => ({
  HomeSubSidebar: () => <div data-testid="home-sub-sidebar" />,
}));

vi.mock("../sidebars/MessagesSubSidebar", () => ({
  MessagesSubSidebar: () => <div data-testid="messages-sub-sidebar" />,
}));

vi.mock("../sidebars/ActivitySubSidebar", () => ({
  ActivitySubSidebar: () => <div data-testid="activity-sub-sidebar" />,
}));

vi.mock("../sidebars/FilesSubSidebar", () => ({
  FilesSubSidebar: () => <div data-testid="files-sub-sidebar" />,
}));

vi.mock("../sidebars/MoreSubSidebar", () => ({
  MoreSubSidebar: () => <div data-testid="more-sub-sidebar" />,
}));

vi.mock("../sidebars/WikiSubSidebar", () => ({
  WikiSubSidebar: () => <div data-testid="wiki-sub-sidebar" />,
}));

describe("DynamicSubSidebar", () => {
  beforeEach(() => {
    pathname = "/wiki";
    useAppStore.getState().reset();
  });

  it("renders the secondary sidebar at the wider default width", () => {
    render(<DynamicSubSidebar />);

    expect(screen.getByTestId("dynamic-sub-sidebar")).toHaveStyle({
      width: `${SUB_SIDEBAR_WIDTH_DEFAULT}px`,
    });
    expect(screen.getByTestId("wiki-sub-sidebar")).toBeInTheDocument();
  });

  it("does not force primary foreground text color onto light sub-sidebars", () => {
    render(<DynamicSubSidebar />);

    expect(screen.getByTestId("dynamic-sub-sidebar")).not.toHaveClass(
      "text-primary-foreground",
    );
  });

  it("persists drag resizing and clamps the maximum width", () => {
    render(<DynamicSubSidebar />);

    act(() => {
      fireEvent.pointerDown(screen.getByTestId("sub-sidebar-resize-handle"), {
        clientX: SUB_SIDEBAR_WIDTH_DEFAULT,
      });
      fireEvent.pointerMove(window, {
        clientX: SUB_SIDEBAR_WIDTH_DEFAULT + 1000,
      });
      fireEvent.pointerUp(window);
    });

    expect(useAppStore.getState().subSidebarWidth).toBe(SUB_SIDEBAR_WIDTH_MAX);
    expect(screen.getByTestId("dynamic-sub-sidebar")).toHaveStyle({
      width: `${SUB_SIDEBAR_WIDTH_MAX}px`,
    });
  });
});

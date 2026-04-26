import { fireEvent, render, screen } from "@testing-library/react";
import type { JSX } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: unknown) => ({ __config: config }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

vi.mock("@/components/routines/RoutinesSidebar", () => ({
  // The sidebar mock exposes its `+` button so tests can verify the
  // index route wires `onRequestCreate` back to the same picker the
  // empty-state CTA opens (shared state — see I1).
  RoutinesSidebar: (props: {
    selectedRoutineId: string | null;
    selectedExecutionId: string | null;
    onRequestCreate?: () => void;
  }) => (
    <div
      data-testid="routines-sidebar"
      data-routine-id={String(props.selectedRoutineId)}
      data-execution-id={String(props.selectedExecutionId)}
    >
      <button
        type="button"
        data-testid="sidebar-plus"
        onClick={() => props.onRequestCreate?.()}
      />
    </div>
  ),
}));

vi.mock("@/components/routines/AgenticAgentPicker", () => ({
  AgenticAgentPicker: (props: { open: boolean }) =>
    props.open ? <div data-testid="agentic-picker-open" /> : null,
}));

vi.mock("@/components/routines/CreateRoutineDialog", () => ({
  CreateRoutineDialog: (props: { isOpen: boolean }) =>
    props.isOpen ? <div data-testid="create-dialog-open" /> : null,
}));

import { Route as IndexRoute } from "../index";

function renderRoute() {
  const Component = (
    IndexRoute as unknown as { __config: { component: () => JSX.Element } }
  ).__config.component;
  return render(<Component />);
}

describe("/_authenticated/routines/ index route", () => {
  it("renders sidebar with null selection plus empty-state center pane", () => {
    renderRoute();

    const sidebar = screen.getByTestId("routines-sidebar");
    expect(sidebar.getAttribute("data-routine-id")).toBe("null");
    expect(sidebar.getAttribute("data-execution-id")).toBe("null");
    expect(screen.getByText("emptyState.title")).toBeInTheDocument();
    // Empty-state CTA button (shadcn Button → renders as a real button).
    expect(
      screen.getByRole("button", { name: /emptyState\.createWithAI/ }),
    ).toBeInTheDocument();
  });

  it("clicking the empty-state 'Create with AI' CTA opens the agentic picker", () => {
    renderRoute();

    // Picker is closed initially.
    expect(screen.queryByTestId("agentic-picker-open")).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /emptyState\.createWithAI/ }),
    );

    // CTA opens the route-owned picker (single source of truth — I1).
    expect(screen.getByTestId("agentic-picker-open")).toBeInTheDocument();
  });

  it("sidebar's onRequestCreate also opens the same route-owned picker", () => {
    renderRoute();

    expect(screen.queryByTestId("agentic-picker-open")).not.toBeInTheDocument();

    // Sidebar `+` button — index route should pass onRequestCreate that
    // toggles the SAME state as the empty-state CTA.
    fireEvent.click(screen.getByTestId("sidebar-plus"));

    expect(screen.getByTestId("agentic-picker-open")).toBeInTheDocument();
  });
});

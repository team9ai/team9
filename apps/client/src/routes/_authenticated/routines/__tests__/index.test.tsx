import { act, fireEvent, render, screen } from "@testing-library/react";
import type { JSX } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockNavigate = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: unknown) => ({ __config: config }),
  useNavigate: () => mockNavigate,
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

let lastOnOpenCreationSession: ((id: string) => void) | null = null;
vi.mock("@/components/routines/AgenticAgentPicker", () => ({
  AgenticAgentPicker: (props: {
    open: boolean;
    onOpenCreationSession: (id: string) => void;
  }) => {
    lastOnOpenCreationSession = props.onOpenCreationSession;
    return props.open ? <div data-testid="agentic-picker-open" /> : null;
  },
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
  beforeEach(() => {
    mockNavigate.mockClear();
    lastOnOpenCreationSession = null;
  });

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

  it("navigates to creation run when picker calls onOpenCreationSession", () => {
    renderRoute();

    // Open the picker so the latest onOpenCreationSession callback is
    // captured by the mock (the mock records the most recent props).
    fireEvent.click(
      screen.getByRole("button", { name: /emptyState\.createWithAI/ }),
    );
    expect(screen.getByTestId("agentic-picker-open")).toBeInTheDocument();
    expect(lastOnOpenCreationSession).toBeTypeOf("function");

    // Simulate AgenticAgentPicker firing onOpenCreationSession after
    // createMutation.onSuccess — the index route should navigate to the
    // freshly-created draft routine's creation run.
    act(() => {
      lastOnOpenCreationSession?.("new-routine-id");
    });

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/routines/$routineId/runs/$executionId",
      params: { routineId: "new-routine-id", executionId: "creation" },
    });
  });
});

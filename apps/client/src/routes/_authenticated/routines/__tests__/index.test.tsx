import { render, screen } from "@testing-library/react";
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
  RoutinesSidebar: (props: {
    selectedRoutineId: string | null;
    selectedExecutionId: string | null;
  }) => (
    <div
      data-testid="routines-sidebar"
      data-routine-id={String(props.selectedRoutineId)}
      data-execution-id={String(props.selectedExecutionId)}
    />
  ),
}));

vi.mock("@/components/routines/AgenticAgentPicker", () => ({
  AgenticAgentPicker: () => null,
}));

vi.mock("@/components/routines/CreateRoutineDialog", () => ({
  CreateRoutineDialog: () => null,
}));

import { Route as IndexRoute } from "../index";

describe("/_authenticated/routines/ index route", () => {
  it("renders sidebar with null selection plus empty-state center pane", () => {
    const Component = (
      IndexRoute as unknown as { __config: { component: () => JSX.Element } }
    ).__config.component;

    render(<Component />);

    const sidebar = screen.getByTestId("routines-sidebar");
    expect(sidebar.getAttribute("data-routine-id")).toBe("null");
    expect(sidebar.getAttribute("data-execution-id")).toBe("null");
    expect(screen.getByText("emptyState.title")).toBeInTheDocument();
    // Empty-state CTA button (shadcn Button → renders as a real button).
    expect(
      screen.getByRole("button", { name: /emptyState\.createWithAI/ }),
    ).toBeInTheDocument();
  });
});

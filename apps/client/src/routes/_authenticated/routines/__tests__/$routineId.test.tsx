import { render, screen } from "@testing-library/react";
import type { JSX } from "react";
import { describe, expect, it, vi } from "vitest";

const routeUseParams = vi.fn(() => ({ routineId: "r-1" }));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: unknown) => ({
    __config: config,
    useParams: () => routeUseParams(),
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

import { Route as DetailRoute } from "../$routineId";

type RouteHandle = {
  __config: {
    component: () => JSX.Element;
    validateSearch: (search: Record<string, unknown>) => unknown;
  };
};

describe("/_authenticated/routines/$routineId placeholder route", () => {
  it("renders sidebar with the URL routineId and the placeholder div", () => {
    const Component = (DetailRoute as unknown as RouteHandle).__config
      .component;

    render(<Component />);

    const sidebar = screen.getByTestId("routines-sidebar");
    expect(sidebar.getAttribute("data-routine-id")).toBe("r-1");
    expect(sidebar.getAttribute("data-execution-id")).toBe("null");
    expect(
      screen.getByTestId("routine-detail-placeholder"),
    ).toBeInTheDocument();
  });

  it("validateSearch keeps allowed tab values", () => {
    const validate = (DetailRoute as unknown as RouteHandle).__config
      .validateSearch;
    expect(validate({ tab: "overview" })).toEqual({ tab: "overview" });
    expect(validate({ tab: "triggers" })).toEqual({ tab: "triggers" });
    expect(validate({ tab: "documents" })).toEqual({ tab: "documents" });
    expect(validate({ tab: "runs" })).toEqual({ tab: "runs" });
  });

  it("validateSearch strips unknown / missing tab values", () => {
    const validate = (DetailRoute as unknown as RouteHandle).__config
      .validateSearch;
    expect(validate({ tab: "settings" })).toEqual({});
    expect(validate({ tab: undefined })).toEqual({});
    expect(validate({})).toEqual({});
  });
});

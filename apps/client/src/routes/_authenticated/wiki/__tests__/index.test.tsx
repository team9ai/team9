import { render } from "@testing-library/react";
import type { JSX } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: unknown) => ({ __config: config }),
}));

vi.mock("@/components/layout/contents/WikiMainContent", () => ({
  WikiMainContent: () => <div data-testid="wiki-main-content" />,
}));

import { Route as WikiIndexRoute } from "../index";

describe("/_authenticated/wiki route component", () => {
  it("renders WikiMainContent directly (no param resolution needed)", () => {
    const Component = (
      WikiIndexRoute as unknown as {
        __config: { component: () => JSX.Element };
      }
    ).__config.component;

    const { getByTestId } = render(<Component />);
    expect(getByTestId("wiki-main-content")).toBeInTheDocument();
  });
});

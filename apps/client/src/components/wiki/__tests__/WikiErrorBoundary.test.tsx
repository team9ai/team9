import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WikiErrorBoundary } from "../WikiErrorBoundary";

/**
 * A child that throws synchronously on first render when `shouldThrow` is
 * true. Used to trigger the boundary's `getDerivedStateFromError` path.
 */
function Boom({ shouldThrow }: { shouldThrow: boolean }): JSX.Element {
  if (shouldThrow) {
    throw new Error("boom");
  }
  return <div data-testid="child-ok">ok</div>;
}

describe("WikiErrorBoundary", () => {
  /**
   * React intentionally logs the uncaught error before the boundary takes
   * over. Silence that so the test output stays readable.
   */
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("renders children normally when no error is thrown", () => {
    render(
      <WikiErrorBoundary>
        <Boom shouldThrow={false} />
      </WikiErrorBoundary>,
    );
    expect(screen.getByTestId("child-ok")).toBeInTheDocument();
    expect(screen.queryByTestId("wiki-error-boundary-fallback")).toBeNull();
  });

  it("renders the fallback when a child throws", () => {
    render(
      <WikiErrorBoundary>
        <Boom shouldThrow />
      </WikiErrorBoundary>,
    );
    const fallback = screen.getByTestId("wiki-error-boundary-fallback");
    expect(fallback).toBeInTheDocument();
    expect(fallback).toHaveAttribute("role", "alert");
    expect(screen.getByTestId("wiki-error-boundary-retry")).toBeInTheDocument();
  });

  it("clears the error state when Retry is clicked", () => {
    const { rerender } = render(
      <WikiErrorBoundary>
        <Boom shouldThrow />
      </WikiErrorBoundary>,
    );
    expect(
      screen.getByTestId("wiki-error-boundary-fallback"),
    ).toBeInTheDocument();

    // Simulate: the underlying bug was fixed (subsequent renders don't throw).
    // Swap the child to a non-throwing one BEFORE clicking retry — otherwise
    // the retry render would hit the error again and stay on the fallback.
    rerender(
      <WikiErrorBoundary>
        <Boom shouldThrow={false} />
      </WikiErrorBoundary>,
    );
    // React doesn't re-try child rendering automatically once the boundary
    // has caught — we must flip the internal flag via the retry button.
    fireEvent.click(screen.getByTestId("wiki-error-boundary-retry"));
    expect(screen.queryByTestId("wiki-error-boundary-fallback")).toBeNull();
    expect(screen.getByTestId("child-ok")).toBeInTheDocument();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, params?: { count?: number }) =>
      params?.count !== undefined ? `${k}:${params.count}` : k,
  }),
}));

// Mock Button to pass through all props cleanly
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    variant,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    variant?: string;
  }) => (
    <button onClick={onClick} disabled={disabled} data-variant={variant}>
      {children}
    </button>
  ),
}));

import { SelectionActionBar } from "../SelectionActionBar";
import { useForwardSelectionStore } from "@/stores/useForwardSelectionStore";

// ── helpers ──────────────────────────────────────────────────────────────────

function resetStore() {
  useForwardSelectionStore.getState().exit();
}

// ── tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  resetStore();
});

describe("SelectionActionBar", () => {
  describe("inactive state", () => {
    it("renders nothing when active is false", () => {
      const { container } = render(<SelectionActionBar onForward={vi.fn()} />);
      expect(container.firstChild).toBeNull();
    });
  });

  describe("active state", () => {
    beforeEach(() => {
      useForwardSelectionStore.getState().enter("ch-1");
    });

    it("renders the bar with count label and buttons when active", () => {
      render(<SelectionActionBar onForward={vi.fn()} />);

      expect(
        screen.getByRole("region", { name: "Selection actions" }),
      ).toBeInTheDocument();
      expect(screen.getByText("forward.selection.bar:0")).toBeInTheDocument();
      expect(screen.getByText("forward.selection.cancel")).toBeInTheDocument();
      expect(screen.getByText("forward.toolbar.forward")).toBeInTheDocument();
    });

    it("Cancel button calls exit (store becomes inactive)", () => {
      render(<SelectionActionBar onForward={vi.fn()} />);

      const cancelBtn = screen.getByText("forward.selection.cancel");
      fireEvent.click(cancelBtn);

      expect(useForwardSelectionStore.getState().active).toBe(false);
    });

    it("Forward button is disabled when nothing is selected", () => {
      render(<SelectionActionBar onForward={vi.fn()} />);

      const forwardBtn = screen.getByText("forward.toolbar.forward");
      expect(forwardBtn).toBeDisabled();
    });

    it("Forward button is enabled when count > 0 and calls onForward", () => {
      useForwardSelectionStore.getState().toggle("msg-1");
      useForwardSelectionStore.getState().toggle("msg-2");

      const onForward = vi.fn();
      render(<SelectionActionBar onForward={onForward} />);

      const forwardBtn = screen.getByText("forward.toolbar.forward");
      expect(forwardBtn).not.toBeDisabled();

      fireEvent.click(forwardBtn);
      expect(onForward).toHaveBeenCalledOnce();
    });

    it("displays the correct count in the label", () => {
      useForwardSelectionStore.getState().toggle("msg-1");
      useForwardSelectionStore.getState().toggle("msg-2");
      useForwardSelectionStore.getState().toggle("msg-3");

      render(<SelectionActionBar onForward={vi.fn()} />);

      expect(screen.getByText("forward.selection.bar:3")).toBeInTheDocument();
    });
  });
});

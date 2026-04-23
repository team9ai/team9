import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

// Mock Radix Popover so PopoverContent always renders (no portal/portal timing issues)
vi.mock("@/components/ui/popover", () => ({
  Popover: ({
    children,
    open,
    onOpenChange,
  }: {
    children: React.ReactNode;
    open?: boolean;
    onOpenChange?: (v: boolean) => void;
  }) => (
    <div
      data-popover-root
      data-open={open}
      onClick={() => onOpenChange?.(!open)}
    >
      {children}
    </div>
  ),
  PopoverTrigger: ({
    children,
    asChild,
  }: {
    children: React.ReactNode;
    asChild?: boolean;
  }) => {
    if (asChild && React.isValidElement(children)) {
      return children;
    }
    return <>{children}</>;
  },
  PopoverContent: ({
    children,
  }: {
    children: React.ReactNode;
    className?: string;
    align?: string;
    side?: string;
  }) => <div data-popover-content>{children}</div>,
}));

import { MessageRelationBar } from "../MessageRelationBar";
import * as hook from "@/hooks/useMessageRelations";
import type { RelationInspectionResult } from "@/types/relations";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function mockHook(data: RelationInspectionResult | undefined) {
  vi.spyOn(hook, "useMessageRelations").mockReturnValue({
    data,
    isLoading: false,
    isError: false,
    error: null,
    status: "success",
  } as ReturnType<typeof hook.useMessageRelations>);
}

describe("MessageRelationBar", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders nothing when data is undefined (loading)", () => {
    vi.spyOn(hook, "useMessageRelations").mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      status: "pending",
    } as ReturnType<typeof hook.useMessageRelations>);

    const { container } = render(<MessageRelationBar messageId="m1" />, {
      wrapper,
    });
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when all buckets are empty", () => {
    mockHook({
      outgoing: { parent: [], related: [] },
      incoming: { children: [], relatedBy: [] },
    });

    const { container } = render(<MessageRelationBar messageId="m1" />, {
      wrapper,
    });
    expect(container.firstChild).toBeNull();
  });

  it("renders parent bucket label when parent present", () => {
    mockHook({
      outgoing: {
        parent: [
          {
            messageId: "p1",
            depth: 1,
            propertyDefinitionId: "d1",
            parentSource: "relation",
          },
        ],
        related: [],
      },
      incoming: { children: [], relatedBy: [] },
    });

    render(<MessageRelationBar messageId="m1" />, { wrapper });
    expect(screen.getByText(/↑ 父/)).toBeInTheDocument();
  });

  it("renders four bucket labels when all populated", () => {
    mockHook({
      outgoing: {
        parent: [
          {
            messageId: "p1",
            depth: 1,
            propertyDefinitionId: "d1",
            parentSource: "relation",
          },
        ],
        related: [{ messageId: "r1", propertyDefinitionId: "d1" }],
      },
      incoming: {
        children: [
          {
            messageId: "c1",
            depth: 1,
            propertyDefinitionId: "d1",
            parentSource: "relation",
          },
        ],
        relatedBy: [{ messageId: "b1", propertyDefinitionId: "d1" }],
      },
    });

    render(<MessageRelationBar messageId="m1" />, { wrapper });
    expect(screen.getByText(/↑ 父/)).toBeInTheDocument();
    expect(screen.getByText(/↓ 子/)).toBeInTheDocument();
    expect(screen.getByText(/↔ 关联/)).toBeInTheDocument();
    expect(screen.getByText(/← 被关联/)).toBeInTheDocument();
  });

  it("renders only present bucket labels (no children or relatedBy)", () => {
    mockHook({
      outgoing: {
        parent: [
          {
            messageId: "p1",
            depth: 1,
            propertyDefinitionId: "d1",
            parentSource: "relation",
          },
        ],
        related: [],
      },
      incoming: { children: [], relatedBy: [] },
    });

    render(<MessageRelationBar messageId="m1" />, { wrapper });
    expect(screen.getByText(/↑ 父/)).toBeInTheDocument();
    expect(screen.queryByText(/↓ 子/)).not.toBeInTheDocument();
    expect(screen.queryByText(/↔ 关联/)).not.toBeInTheDocument();
    expect(screen.queryByText(/← 被关联/)).not.toBeInTheDocument();
  });

  it("shows up to 3 chips inline and collapses the rest into +N button", () => {
    mockHook({
      outgoing: { parent: [], related: [] },
      incoming: {
        children: [1, 2, 3, 4, 5, 6].map((i) => ({
          messageId: `c${i}`,
          depth: 1,
          propertyDefinitionId: "d1",
          parentSource: "relation" as const,
        })),
        relatedBy: [],
      },
    });

    render(<MessageRelationBar messageId="m1" />, { wrapper });
    // 3 overflow items → +3 button
    expect(screen.getByText("+3")).toBeInTheDocument();
  });

  it("shows overflow chips after clicking the +N button", () => {
    mockHook({
      outgoing: { parent: [], related: [] },
      incoming: {
        children: [1, 2, 3, 4, 5, 6].map((i) => ({
          messageId: `c${i}`,
          depth: 1,
          propertyDefinitionId: "d1",
          parentSource: "relation" as const,
        })),
        relatedBy: [],
      },
    });

    render(<MessageRelationBar messageId="m1" />, { wrapper });
    const overflowBtn = screen.getByText("+3");
    fireEvent.click(overflowBtn);

    // overflow chips c4, c5, c6 should now be visible
    expect(screen.getAllByTestId("message-ref-chip")).toHaveLength(6);
  });

  it("renders 🧵 badge on parent chip when parentSource=thread", () => {
    mockHook({
      outgoing: {
        parent: [
          {
            messageId: "p1",
            depth: 1,
            propertyDefinitionId: "d1",
            parentSource: "thread",
          },
        ],
        related: [],
      },
      incoming: { children: [], relatedBy: [] },
    });

    render(<MessageRelationBar messageId="m1" />, { wrapper });
    expect(screen.getByLabelText("thread-derived")).toBeInTheDocument();
  });

  it("does not render 🧵 badge on parent chip when parentSource=relation", () => {
    mockHook({
      outgoing: {
        parent: [
          {
            messageId: "p1",
            depth: 1,
            propertyDefinitionId: "d1",
            parentSource: "relation",
          },
        ],
        related: [],
      },
      incoming: { children: [], relatedBy: [] },
    });

    render(<MessageRelationBar messageId="m1" />, { wrapper });
    expect(screen.queryByLabelText("thread-derived")).not.toBeInTheDocument();
  });

  it("does not render 🧵 badge on children chips even when parentSource=thread", () => {
    mockHook({
      outgoing: { parent: [], related: [] },
      incoming: {
        children: [
          {
            messageId: "c1",
            depth: 1,
            propertyDefinitionId: "d1",
            parentSource: "thread",
          },
        ],
        relatedBy: [],
      },
    });

    render(<MessageRelationBar messageId="m1" />, { wrapper });
    // Children row never passes showThreadBadge — no badge expected
    expect(screen.queryByLabelText("thread-derived")).not.toBeInTheDocument();
  });

  it("does not render 🧵 badge on related chips", () => {
    mockHook({
      outgoing: {
        parent: [],
        related: [{ messageId: "r1", propertyDefinitionId: "d1" }],
      },
      incoming: { children: [], relatedBy: [] },
    });

    render(<MessageRelationBar messageId="m1" />, { wrapper });
    expect(screen.queryByLabelText("thread-derived")).not.toBeInTheDocument();
  });

  it("calls onNavigate with messageId when chip is clicked", () => {
    mockHook({
      outgoing: {
        parent: [
          {
            messageId: "parent-msg-id",
            depth: 1,
            propertyDefinitionId: "d1",
            parentSource: "relation",
          },
        ],
        related: [],
      },
      incoming: { children: [], relatedBy: [] },
    });

    const onNavigate = vi.fn();
    render(<MessageRelationBar messageId="m1" onNavigate={onNavigate} />, {
      wrapper,
    });

    const chips = screen.getAllByTestId("message-ref-chip");
    fireEvent.click(chips[0]);
    expect(onNavigate).toHaveBeenCalledWith("parent-msg-id");
  });

  it("does not call onNavigate when onNavigate is not provided", () => {
    mockHook({
      outgoing: {
        parent: [
          {
            messageId: "parent-msg-id",
            depth: 1,
            propertyDefinitionId: "d1",
            parentSource: "relation",
          },
        ],
        related: [],
      },
      incoming: { children: [], relatedBy: [] },
    });

    render(<MessageRelationBar messageId="m1" />, { wrapper });
    const chips = screen.getAllByTestId("message-ref-chip");
    // should not throw when clicked with no onNavigate
    expect(() => fireEvent.click(chips[0])).not.toThrow();
  });

  it("shows +N only when items exceed MAX_INLINE (exactly 3 inline, no overflow)", () => {
    mockHook({
      outgoing: { parent: [], related: [] },
      incoming: {
        children: [1, 2, 3].map((i) => ({
          messageId: `c${i}`,
          depth: 1,
          propertyDefinitionId: "d1",
          parentSource: "relation" as const,
        })),
        relatedBy: [],
      },
    });

    render(<MessageRelationBar messageId="m1" />, { wrapper });
    expect(screen.queryByText(/^\+\d+$/)).not.toBeInTheDocument();
    expect(screen.getAllByTestId("message-ref-chip")).toHaveLength(3);
  });

  it("shows +1 when there are exactly 4 items", () => {
    mockHook({
      outgoing: { parent: [], related: [] },
      incoming: {
        children: [1, 2, 3, 4].map((i) => ({
          messageId: `c${i}`,
          depth: 1,
          propertyDefinitionId: "d1",
          parentSource: "relation" as const,
        })),
        relatedBy: [],
      },
    });

    render(<MessageRelationBar messageId="m1" />, { wrapper });
    expect(screen.getByText("+1")).toBeInTheDocument();
  });
});

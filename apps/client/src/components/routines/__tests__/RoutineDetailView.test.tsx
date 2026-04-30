import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockNavigate = vi.fn();
const mockDelete = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

vi.mock("@/services/api/routines", () => ({
  routinesApi: {
    delete: (...args: unknown[]) => mockDelete(...args),
  },
}));

vi.mock("../RoutineTriggersTab", () => ({
  RoutineTriggersTab: ({ routineId }: { routineId: string }) => (
    <div data-testid="triggers-tab" data-routine-id={routineId} />
  ),
}));

vi.mock("../RoutineSkillFolderTab", () => ({
  RoutineSkillFolderTab: ({ routine }: { routine: { id: string } }) => (
    <div data-testid="documents-tab" data-routine-id={routine.id} />
  ),
}));

vi.mock("../tabs/RoutineOverviewTab", () => ({
  RoutineOverviewTab: ({ routine }: { routine: { id: string } }) => (
    <div data-testid="overview-tab" data-routine-id={routine.id} />
  ),
}));

vi.mock("../tabs/RoutineRunsTab", () => ({
  RoutineRunsTab: ({
    routineId,
    selectedExecutionId,
    active,
  }: {
    routineId: string;
    selectedExecutionId: string | null;
    active: boolean;
  }) => (
    <div
      data-testid="runs-tab"
      data-routine-id={routineId}
      data-selected-execution-id={selectedExecutionId ?? ""}
      data-active={String(active)}
    />
  ),
}));

// Radix DropdownMenu relies on pointer events jsdom doesn't fire from a plain
// `fireEvent.click`. Swap the UI wrapper for a minimal controlled menu so the
// tests can drive the exact prop surface the component cares about.
vi.mock("@/components/ui/dropdown-menu", async () => {
  const React = await import("react");
  const Ctx = React.createContext<{
    open: boolean;
    setOpen: (next: boolean) => void;
  }>({
    open: false,
    setOpen: () => {},
  });

  const DropdownMenu = ({ children }: { children: React.ReactNode }) => {
    const [open, setOpen] = React.useState(false);
    return <Ctx.Provider value={{ open, setOpen }}>{children}</Ctx.Provider>;
  };

  const DropdownMenuTrigger = ({
    children,
  }: {
    asChild?: boolean;
    children: React.ReactNode;
  }) => {
    const { setOpen, open } = React.useContext(Ctx);
    if (React.isValidElement(children)) {
      const child = children as React.ReactElement<Record<string, unknown>>;
      return React.cloneElement(child, {
        onClick: (e: React.MouseEvent) => {
          (
            child.props.onClick as ((e: React.MouseEvent) => void) | undefined
          )?.(e);
          setOpen(!open);
        },
      });
    }
    return <>{children}</>;
  };

  const DropdownMenuContent = ({ children }: { children: React.ReactNode }) => {
    const { open } = React.useContext(Ctx);
    return open ? <div role="menu">{children}</div> : null;
  };

  const DropdownMenuItem = ({
    children,
    onClick,
    disabled,
    className,
  }: {
    children: React.ReactNode;
    onClick?: (e: React.MouseEvent) => void;
    disabled?: boolean;
    className?: string;
  }) => {
    const { setOpen } = React.useContext(Ctx);
    return (
      <button
        type="button"
        role="menuitem"
        disabled={disabled}
        className={className}
        onClick={(e) => {
          onClick?.(e);
          setOpen(false);
        }}
      >
        {children}
      </button>
    );
  };

  return {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
  };
});

vi.mock("@/components/ui/alert-dialog", async () => {
  const React = await import("react");
  type CloseFn = (v: boolean) => void;
  const CloseCtx = React.createContext<CloseFn>(() => {});

  const AlertDialog = ({
    open,
    onOpenChange,
    children,
  }: {
    open?: boolean;
    onOpenChange?: CloseFn;
    children: React.ReactNode;
  }) => (
    <CloseCtx.Provider value={onOpenChange ?? (() => {})}>
      {open ? children : null}
    </CloseCtx.Provider>
  );

  const AlertDialogContent = ({ children }: { children: React.ReactNode }) => (
    <div role="alertdialog">{children}</div>
  );
  const AlertDialogHeader = ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  );
  const AlertDialogTitle = ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  );
  const AlertDialogDescription = ({
    children,
  }: {
    children: React.ReactNode;
  }) => <p>{children}</p>;
  const AlertDialogFooter = ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  );
  const AlertDialogCancel = ({ children }: { children: React.ReactNode }) => {
    const close = React.useContext(CloseCtx);
    return (
      <button type="button" onClick={() => close(false)}>
        {children}
      </button>
    );
  };
  // Intentionally does NOT call close(false) so tests can inspect `disabled`
  // while the mutation is still pending.
  const AlertDialogAction = ({
    children,
    onClick,
    disabled,
    className,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    className?: string;
  }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={className}
    >
      {children}
    </button>
  );

  return {
    AlertDialog,
    AlertDialogContent,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogCancel,
    AlertDialogAction,
  };
});

import { RoutineDetailView } from "../RoutineDetailView";
import type { RoutineDetail, RoutineStatus } from "@/types/routine";

const baseRoutine: RoutineDetail = {
  id: "r1",
  tenantId: "t1",
  botId: null,
  creatorId: "u1",
  title: "Daily summary",
  description: null,
  status: "completed",
  scheduleType: "once",
  scheduleConfig: null,
  nextRunAt: null,
  version: 1,
  documentId: null,
  folderId: "f1",
  currentExecutionId: null,
  tokenUsage: 0,
  creationChannelId: null,
  creationSessionId: null,
  sourceRef: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  currentExecution: null,
};

function renderView(
  props: Partial<{
    tab: "overview" | "triggers" | "documents" | "runs";
    routine: RoutineDetail;
  }> = {},
) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onTabChange = vi.fn();
  const utils = render(
    <QueryClientProvider client={qc}>
      <RoutineDetailView
        routine={props.routine ?? baseRoutine}
        tab={props.tab ?? "overview"}
        onTabChange={onTabChange}
      />
    </QueryClientProvider>,
  );
  return { ...utils, onTabChange };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RoutineDetailView", () => {
  it("renders the routine title", () => {
    renderView();
    expect(screen.getByText("Daily summary")).toBeInTheDocument();
  });

  it("renders status pill with status-aware aria-label", () => {
    const { container } = renderView();
    const pill = container.querySelector('[aria-label="status.completed"]');
    expect(pill).not.toBeNull();
  });

  it("activates the Overview tab by default and forwards routine.id", () => {
    renderView({ tab: "overview" });
    const ov = screen.getByTestId("overview-tab");
    expect(ov).toBeInTheDocument();
    expect(ov).toHaveAttribute("data-routine-id", "r1");
  });

  it("activates the Triggers tab and forwards routineId when tab='triggers'", () => {
    renderView({ tab: "triggers" });
    const trig = screen.getByTestId("triggers-tab");
    expect(trig).toBeInTheDocument();
    expect(trig).toHaveAttribute("data-routine-id", "r1");
  });

  it("activates the Documents tab and forwards routine.id when tab='documents'", () => {
    renderView({ tab: "documents" });
    const docs = screen.getByTestId("documents-tab");
    expect(docs).toBeInTheDocument();
    expect(docs).toHaveAttribute("data-routine-id", "r1");
  });

  it("activates the Runs tab and forwards routine.id with active=true when tab='runs'", () => {
    renderView({ tab: "runs" });
    const runs = screen.getByTestId("runs-tab");
    expect(runs).toBeInTheDocument();
    expect(runs).toHaveAttribute("data-routine-id", "r1");
    expect(runs).toHaveAttribute("data-selected-execution-id", "");
    expect(runs).toHaveAttribute("data-active", "true");
  });

  it("calls onTabChange when a tab trigger is activated", () => {
    const { onTabChange } = renderView({ tab: "overview" });
    // Radix Tabs uses pointer/mouse events for activation. Fire both so the
    // primitive's internal onMouseDown / onClick paths both run.
    const docsTab = screen.getByRole("tab", { name: "Documents" });
    fireEvent.mouseDown(docsTab);
    fireEvent.click(docsTab);
    expect(onTabChange).toHaveBeenCalledWith("documents");
  });

  it("hides the kebab trigger when status is in_progress (not deletable)", () => {
    renderView({
      routine: { ...baseRoutine, status: "in_progress" as RoutineStatus },
    });
    expect(screen.queryByLabelText("More")).toBeNull();
    expect(screen.queryByText("detail.delete")).toBeNull();
  });

  it.each<RoutineStatus>(["draft", "paused", "pending_action"])(
    "hides the kebab trigger for non-deletable status '%s'",
    (status) => {
      renderView({ routine: { ...baseRoutine, status } });
      expect(screen.queryByLabelText("More")).toBeNull();
      expect(screen.queryByText("detail.delete")).toBeNull();
    },
  );

  it.each<RoutineStatus>([
    "upcoming",
    "completed",
    "failed",
    "stopped",
    "timeout",
  ])("shows Delete entry for deletable status '%s'", async (status) => {
    renderView({ routine: { ...baseRoutine, status } });
    fireEvent.click(screen.getByLabelText("More"));
    await screen.findByText("detail.delete");
  });

  it("shows Delete entry and deletes on confirm for completed routine", async () => {
    mockDelete.mockResolvedValue(undefined);
    renderView({ routine: { ...baseRoutine, status: "completed" } });
    fireEvent.click(screen.getByLabelText("More"));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /detail\.delete/ }),
    );
    // Confirmation dialog action button — it's a true <button> rendered by
    // AlertDialogAction. The menu item has role=menuitem, so this query
    // does not collide with the kebab menu.
    fireEvent.click(
      await screen.findByRole("button", { name: "detail.delete" }),
    );
    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith("r1");
    });
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({ to: "/routines" });
    });
  });

  it("does NOT navigate when delete mutation fails", async () => {
    mockDelete.mockRejectedValue(new Error("boom"));
    renderView({ routine: { ...baseRoutine, status: "completed" } });
    fireEvent.click(screen.getByLabelText("More"));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /detail\.delete/ }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "detail.delete" }),
    );
    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith("r1");
    });
    // Navigation only fires onSuccess; on error it must NOT navigate.
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("cancels deletion via the AlertDialog Cancel button without calling delete", async () => {
    renderView({ routine: { ...baseRoutine, status: "completed" } });
    fireEvent.click(screen.getByLabelText("More"));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /detail\.delete/ }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Cancel" }),
      ).not.toBeInTheDocument();
    });
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("confirm button is disabled while delete mutation is pending", async () => {
    let resolveDelete!: (v: undefined) => void;
    mockDelete.mockImplementation(
      () =>
        new Promise<undefined>((resolve) => {
          resolveDelete = resolve;
        }),
    );

    renderView({ routine: { ...baseRoutine, status: "completed" } });
    fireEvent.click(screen.getByLabelText("More"));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /detail\.delete/ }),
    );

    const confirmBtn = await screen.findByRole("button", {
      name: "detail.delete",
    });
    expect(confirmBtn).not.toBeDisabled();

    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "detail.delete" }),
      ).toBeDisabled();
    });

    resolveDelete(undefined);
  });
});

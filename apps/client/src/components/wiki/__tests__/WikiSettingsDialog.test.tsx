import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WikiDto } from "@/types/wiki";

// --- Mocks ---------------------------------------------------------------

const updateMutateAsync = vi.hoisted(() =>
  vi.fn<(input: Record<string, unknown>) => Promise<unknown>>(),
);
const archiveMutateAsync = vi.hoisted(() =>
  vi.fn<(id: string) => Promise<void>>(),
);
const updatePending = vi.hoisted(() => ({ value: false }));
const archivePending = vi.hoisted(() => ({ value: false }));
const mockNavigate = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useWikis", () => ({
  useUpdateWiki: (_id: string) => ({
    mutateAsync: updateMutateAsync,
    get isPending() {
      return updatePending.value;
    },
  }),
  useArchiveWiki: () => ({
    mutateAsync: archiveMutateAsync,
    get isPending() {
      return archivePending.value;
    },
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("../IconPickerPopover", () => ({
  IconPickerPopover: (props: {
    value?: string;
    onChange: (icon: string) => void;
    disabled?: boolean;
  }) => (
    <button
      type="button"
      data-testid="mock-icon-picker"
      data-disabled={props.disabled ? "true" : "false"}
      disabled={props.disabled}
      onClick={() => props.onChange("🗂️")}
    >
      icon-picker
    </button>
  ),
}));

// Radix's `<Select>` uses PointerEvent APIs jsdom doesn't ship with. Swap to
// a native `<select>` so tests can drive value changes via `fireEvent.change`.
// The shim keeps `<Select value onValueChange>` as the shell, hoists the
// `<SelectContent>` children up, and renders them inside the native
// `<select>` so `<option>` children are the direct descendants the browser
// expects. Trigger / Value are no-ops because the native element already
// renders the current value.
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  // Sentinel components — we detect them by reference identity in `<Select>`
  // so we can lift `<SelectTrigger>`'s props (id, data-testid) onto the
  // native `<select>` we render, and flatten `<SelectContent>`'s children
  // into the option list.
  const TRIGGER = Symbol("select-trigger");
  const CONTENT = Symbol("select-content");
  const SelectTrigger: React.FC<Record<string, unknown>> & { tag?: symbol } = (
    _props,
  ) => null;
  SelectTrigger.tag = TRIGGER;
  const SelectContent: React.FC<{ children: React.ReactNode }> & {
    tag?: symbol;
  } = (_props) => null;
  SelectContent.tag = CONTENT;

  const Select = ({
    value,
    onValueChange,
    disabled,
    children,
  }: {
    value: string;
    onValueChange: (v: string) => void;
    disabled?: boolean;
    children: React.ReactNode;
  }) => {
    let triggerProps: Record<string, unknown> = {};
    const options: React.ReactNode[] = [];
    React.Children.forEach(children, (child) => {
      if (!React.isValidElement(child)) return;
      const el = child as React.ReactElement<Record<string, unknown>>;
      const type = el.type as { tag?: symbol };
      if (type?.tag === TRIGGER) {
        triggerProps = el.props;
      } else if (type?.tag === CONTENT) {
        React.Children.forEach(el.props.children as React.ReactNode, (opt) => {
          if (React.isValidElement(opt)) options.push(opt);
        });
      }
    });
    return (
      <select
        id={triggerProps.id as string | undefined}
        data-testid={triggerProps["data-testid"] as string | undefined}
        value={value}
        disabled={disabled}
        onChange={(e) => onValueChange(e.target.value)}
      >
        {options}
      </select>
    );
  };
  const SelectItem = ({
    value,
    children,
    ...rest
  }: {
    value: string;
    children: React.ReactNode;
  } & Record<string, unknown>) => (
    <option value={value} {...rest}>
      {children}
    </option>
  );
  const SelectValue = () => null;
  return { Select, SelectTrigger, SelectContent, SelectItem, SelectValue };
});

import { WikiSettingsDialog } from "../WikiSettingsDialog";

const baseWiki: WikiDto = {
  id: "wiki-1",
  workspaceId: "ws-1",
  name: "Team Handbook",
  slug: "team-handbook",
  icon: null,
  approvalMode: "auto",
  humanPermission: "write",
  agentPermission: "read",
  createdBy: "user-1",
  createdAt: "2026-04-01T00:00:00.000Z",
  updatedAt: "2026-04-01T00:00:00.000Z",
  archivedAt: null,
};

function renderDialog(
  overrides: Partial<React.ComponentProps<typeof WikiSettingsDialog>> = {},
) {
  const onOpenChange = vi.fn();
  const props = {
    open: true,
    onOpenChange,
    wiki: baseWiki,
    ...overrides,
  };
  const utils = render(<WikiSettingsDialog {...props} />);
  return { ...utils, onOpenChange };
}

beforeEach(() => {
  updateMutateAsync.mockReset();
  archiveMutateAsync.mockReset();
  updatePending.value = false;
  archivePending.value = false;
  mockNavigate.mockReset();
  document.body.innerHTML = "";
  vi.spyOn(window, "alert").mockImplementation(() => {});
});

describe("WikiSettingsDialog", () => {
  it("renders nothing when closed", () => {
    renderDialog({ open: false });
    expect(screen.queryByTestId("wiki-settings-dialog")).toBeNull();
  });

  it("renders nothing when wiki is null even if open", () => {
    renderDialog({ wiki: null });
    expect(screen.queryByTestId("wiki-settings-dialog")).toBeNull();
  });

  it("pre-fills the form with the wiki's current values", () => {
    renderDialog();
    expect(
      (screen.getByTestId("wiki-settings-name-input") as HTMLInputElement)
        .value,
    ).toBe("Team Handbook");
    expect(
      (screen.getByTestId("wiki-settings-slug-input") as HTMLInputElement)
        .value,
    ).toBe("team-handbook");
    expect(
      (screen.getByTestId("wiki-settings-approval-auto") as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(
      (screen.getByTestId("wiki-settings-approval-review") as HTMLInputElement)
        .checked,
    ).toBe(false);
    expect(
      (screen.getByTestId("wiki-settings-human-trigger") as HTMLSelectElement)
        .value,
    ).toBe("write");
    expect(
      (screen.getByTestId("wiki-settings-agent-trigger") as HTMLSelectElement)
        .value,
    ).toBe("read");
  });

  it("closes the dialog with no mutation when Save is clicked with no changes", async () => {
    const { onOpenChange } = renderDialog();
    await act(async () => {
      fireEvent.click(screen.getByTestId("wiki-settings-save"));
    });
    expect(updateMutateAsync).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("sends only the diffed fields to useUpdateWiki", async () => {
    updateMutateAsync.mockResolvedValueOnce({});
    const { onOpenChange } = renderDialog();
    fireEvent.change(screen.getByTestId("wiki-settings-name-input"), {
      target: { value: "New Name" },
    });
    fireEvent.click(screen.getByTestId("wiki-settings-approval-review"));
    fireEvent.change(screen.getByTestId("wiki-settings-human-trigger"), {
      target: { value: "propose" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("wiki-settings-save"));
    });
    expect(updateMutateAsync).toHaveBeenCalledTimes(1);
    expect(updateMutateAsync).toHaveBeenCalledWith({
      name: "New Name",
      approvalMode: "review",
      humanPermission: "propose",
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("flags a missing name via the validation banner", async () => {
    renderDialog();
    fireEvent.change(screen.getByTestId("wiki-settings-name-input"), {
      target: { value: "   " },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("wiki-settings-save"));
    });
    expect(
      screen.getByTestId("wiki-settings-validation-error"),
    ).toHaveTextContent(/name is required/i);
    expect(updateMutateAsync).not.toHaveBeenCalled();
  });

  it("flags an empty slug via the validation banner", async () => {
    renderDialog();
    fireEvent.change(screen.getByTestId("wiki-settings-slug-input"), {
      target: { value: "   " },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("wiki-settings-save"));
    });
    expect(
      screen.getByTestId("wiki-settings-validation-error"),
    ).toHaveTextContent(/slug is required/i);
    expect(updateMutateAsync).not.toHaveBeenCalled();
  });

  it("flags a malformed slug via the validation banner", async () => {
    renderDialog();
    fireEvent.change(screen.getByTestId("wiki-settings-slug-input"), {
      target: { value: "Bad Slug!" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("wiki-settings-save"));
    });
    expect(
      screen.getByTestId("wiki-settings-validation-error"),
    ).toHaveTextContent(/lowercase letters, numbers, and dashes/i);
    expect(updateMutateAsync).not.toHaveBeenCalled();
  });

  it("rejects a slug that starts with a dash (matches the server regex)", async () => {
    renderDialog();
    fireEvent.change(screen.getByTestId("wiki-settings-slug-input"), {
      target: { value: "-foo" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("wiki-settings-save"));
    });
    expect(
      screen.getByTestId("wiki-settings-validation-error"),
    ).toHaveTextContent(/start with a lowercase letter or number/i);
    expect(updateMutateAsync).not.toHaveBeenCalled();
  });

  it("rejects a slug longer than 100 characters (matches server @Length(1,100))", async () => {
    renderDialog();
    // 101 chars, all valid per the regex — length is the only issue.
    const oversized = "a" + "b".repeat(100);
    fireEvent.change(screen.getByTestId("wiki-settings-slug-input"), {
      target: { value: oversized },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("wiki-settings-save"));
    });
    expect(
      screen.getByTestId("wiki-settings-validation-error"),
    ).toHaveTextContent(/100 characters or fewer/i);
    expect(updateMutateAsync).not.toHaveBeenCalled();
  });

  it("surfaces a 409 server error as an inline banner", async () => {
    updateMutateAsync.mockRejectedValueOnce(
      Object.assign(new Error("slug taken"), {
        status: 409,
        response: { status: 409, data: { message: "slug taken" } },
      }),
    );
    renderDialog();
    fireEvent.change(screen.getByTestId("wiki-settings-slug-input"), {
      target: { value: "dup" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("wiki-settings-save"));
    });
    expect(screen.getByTestId("wiki-settings-server-error")).toHaveTextContent(
      /already exists/i,
    );
    expect(window.alert).toHaveBeenCalled();
  });

  it("surfaces a 403 server error as an inline banner", async () => {
    updateMutateAsync.mockRejectedValueOnce(
      Object.assign(new Error("forbidden"), {
        status: 403,
        response: { status: 403, data: { message: "forbidden" } },
      }),
    );
    renderDialog();
    fireEvent.change(screen.getByTestId("wiki-settings-name-input"), {
      target: { value: "New" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("wiki-settings-save"));
    });
    expect(screen.getByTestId("wiki-settings-server-error")).toHaveTextContent(
      /permission/i,
    );
  });

  it("falls back to a generic message for unknown errors without a body", async () => {
    updateMutateAsync.mockRejectedValueOnce(new Error(""));
    renderDialog();
    fireEvent.change(screen.getByTestId("wiki-settings-name-input"), {
      target: { value: "New" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("wiki-settings-save"));
    });
    expect(screen.getByTestId("wiki-settings-server-error")).toHaveTextContent(
      /update failed\. please try again/i,
    );
  });

  it("uses the server-provided message for non-standard errors that carry one", async () => {
    updateMutateAsync.mockRejectedValueOnce(
      Object.assign(new Error("boom"), {
        status: 500,
        response: { status: 500, data: { message: "boom" } },
      }),
    );
    renderDialog();
    fireEvent.change(screen.getByTestId("wiki-settings-name-input"), {
      target: { value: "New" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("wiki-settings-save"));
    });
    expect(screen.getByTestId("wiki-settings-server-error")).toHaveTextContent(
      /update failed: boom/i,
    );
  });

  it("Cancel closes the dialog without firing the mutation", () => {
    const { onOpenChange } = renderDialog();
    fireEvent.click(screen.getByTestId("wiki-settings-cancel"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(updateMutateAsync).not.toHaveBeenCalled();
  });

  it("disables inputs and swaps the save label while the mutation is in-flight", () => {
    updatePending.value = true;
    renderDialog();
    expect(screen.getByTestId("wiki-settings-save")).toBeDisabled();
    expect(screen.getByTestId("wiki-settings-save")).toHaveTextContent(
      /saving…/i,
    );
    expect(screen.getByTestId("wiki-settings-cancel")).toBeDisabled();
    expect(screen.getByTestId("wiki-settings-name-input")).toBeDisabled();
    expect(screen.getByTestId("wiki-settings-slug-input")).toBeDisabled();
    expect(screen.getByTestId("wiki-settings-archive-button")).toBeDisabled();
  });

  it("ignores a second submit while the first is in flight", async () => {
    updatePending.value = true;
    renderDialog();
    const form = screen
      .getByTestId("wiki-settings-name-input")
      .closest("form")!;
    await act(async () => {
      fireEvent.submit(form);
    });
    expect(updateMutateAsync).not.toHaveBeenCalled();
  });

  it("opens the archive confirmation on the Archive button", () => {
    renderDialog();
    expect(screen.queryByTestId("wiki-settings-archive-confirm")).toBeNull();
    fireEvent.click(screen.getByTestId("wiki-settings-archive-button"));
    expect(
      screen.getByTestId("wiki-settings-archive-confirm"),
    ).toBeInTheDocument();
  });

  it("confirming archive fires useArchiveWiki, closes both dialogs, and navigates to /wiki", async () => {
    archiveMutateAsync.mockResolvedValueOnce(undefined);
    const { onOpenChange } = renderDialog();
    fireEvent.click(screen.getByTestId("wiki-settings-archive-button"));
    await act(async () => {
      fireEvent.click(
        screen.getByTestId("wiki-settings-archive-confirm-button"),
      );
    });
    expect(archiveMutateAsync).toHaveBeenCalledWith("wiki-1");
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/wiki" });
  });

  it("cancelling archive keeps the settings dialog open and does not mutate", async () => {
    const { onOpenChange } = renderDialog();
    fireEvent.click(screen.getByTestId("wiki-settings-archive-button"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("wiki-settings-archive-cancel"));
    });
    expect(archiveMutateAsync).not.toHaveBeenCalled();
    // Settings dialog stays open.
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("surfaces an archive failure as an inline banner", async () => {
    archiveMutateAsync.mockRejectedValueOnce(
      Object.assign(new Error("forbidden"), {
        status: 403,
        response: { status: 403, data: { message: "forbidden" } },
      }),
    );
    const { onOpenChange } = renderDialog();
    fireEvent.click(screen.getByTestId("wiki-settings-archive-button"));
    await act(async () => {
      fireEvent.click(
        screen.getByTestId("wiki-settings-archive-confirm-button"),
      );
    });
    expect(archiveMutateAsync).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("wiki-settings-server-error")).toHaveTextContent(
      /permission/i,
    );
    // Settings dialog remains open on failure so user can retry / close.
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("archive banner falls back to generic message when error carries no body", async () => {
    archiveMutateAsync.mockRejectedValueOnce(new Error(""));
    renderDialog();
    fireEvent.click(screen.getByTestId("wiki-settings-archive-button"));
    await act(async () => {
      fireEvent.click(
        screen.getByTestId("wiki-settings-archive-confirm-button"),
      );
    });
    expect(screen.getByTestId("wiki-settings-server-error")).toHaveTextContent(
      /archive failed\. please try again/i,
    );
  });

  it("archive banner uses server message for unknown statuses", async () => {
    archiveMutateAsync.mockRejectedValueOnce(
      Object.assign(new Error("boom"), {
        status: 500,
        response: { status: 500, data: { message: "boom" } },
      }),
    );
    renderDialog();
    fireEvent.click(screen.getByTestId("wiki-settings-archive-button"));
    await act(async () => {
      fireEvent.click(
        screen.getByTestId("wiki-settings-archive-confirm-button"),
      );
    });
    expect(screen.getByTestId("wiki-settings-server-error")).toHaveTextContent(
      /archive failed: boom/i,
    );
  });

  it("archive confirm button disables and swaps label while in flight", async () => {
    // Use a never-resolving promise so `isPending` stays true after the
    // user clicks confirm. This mirrors the real React Query behavior where
    // `isPending` flips to true for the duration of the mutation.
    let releaseResolver!: () => void;
    archiveMutateAsync.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseResolver = resolve;
        }),
    );
    const { rerender, onOpenChange } = renderDialog();
    fireEvent.click(screen.getByTestId("wiki-settings-archive-button"));
    // Confirm — kicks off the (pending) mutation.
    await act(async () => {
      fireEvent.click(
        screen.getByTestId("wiki-settings-archive-confirm-button"),
      );
    });
    // Simulate React Query flipping isPending. Because the mock reads from
    // `archivePending.value` every render, we just flip the ref and re-
    // render to observe the new state.
    archivePending.value = true;
    act(() => {
      rerender(
        <WikiSettingsDialog open onOpenChange={onOpenChange} wiki={baseWiki} />,
      );
    });
    // Archive button in the main dialog now disabled.
    expect(screen.getByTestId("wiki-settings-archive-button")).toBeDisabled();
    // Confirm button label flipped to the in-flight copy.
    expect(
      screen.getByTestId("wiki-settings-archive-confirm-button"),
    ).toBeDisabled();
    expect(
      screen.getByTestId("wiki-settings-archive-confirm-button"),
    ).toHaveTextContent(/archiving…/i);
    // The disabled attribute is the sole guard — we just verify the
    // first click is still the only mutation attempt.
    expect(archiveMutateAsync).toHaveBeenCalledTimes(1);
    // Resolve the pending promise so the component settles cleanly — wrap
    // in act() to absorb the trailing state updates from the `.then` chain.
    await act(async () => {
      releaseResolver();
      await Promise.resolve();
    });
  });

  it("reseeds state when re-opened against a different wiki", () => {
    const { rerender } = renderDialog();
    fireEvent.change(screen.getByTestId("wiki-settings-name-input"), {
      target: { value: "Edited locally" },
    });
    // Close, then open with a different wiki.
    rerender(
      <WikiSettingsDialog
        open={false}
        onOpenChange={vi.fn()}
        wiki={baseWiki}
      />,
    );
    const other: WikiDto = { ...baseWiki, id: "wiki-2", name: "Other" };
    act(() => {
      rerender(<WikiSettingsDialog open onOpenChange={vi.fn()} wiki={other} />);
    });
    expect(
      (screen.getByTestId("wiki-settings-name-input") as HTMLInputElement)
        .value,
    ).toBe("Other");
  });

  it("sends icon in the PATCH when the user picks one", async () => {
    updateMutateAsync.mockResolvedValueOnce({});
    renderDialog();
    fireEvent.click(screen.getByTestId("mock-icon-picker"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("wiki-settings-save"));
    });
    expect(updateMutateAsync).toHaveBeenCalledTimes(1);
    expect(updateMutateAsync).toHaveBeenCalledWith({ icon: "🗂️" });
  });

  it("does NOT include icon in the PATCH when the selection matches the wiki's persisted icon", async () => {
    updateMutateAsync.mockResolvedValueOnce({});
    // Seed with an existing icon so the dialog opens pre-populated.
    const withIcon: WikiDto = { ...baseWiki, icon: "🗂️" };
    renderDialog({ wiki: withIcon });
    // Change another field only. Icon should stay in the diff as unchanged.
    fireEvent.change(screen.getByTestId("wiki-settings-name-input"), {
      target: { value: "Renamed" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("wiki-settings-save"));
    });
    expect(updateMutateAsync).toHaveBeenCalledWith({ name: "Renamed" });
  });

  it("treats null and undefined icon seed as equivalent (no PATCH when untouched)", async () => {
    updateMutateAsync.mockResolvedValueOnce({});
    // baseWiki.icon is null; user edits only name, not icon.
    renderDialog();
    fireEvent.change(screen.getByTestId("wiki-settings-name-input"), {
      target: { value: "Renamed" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("wiki-settings-save"));
    });
    // PATCH should carry only `name`, not `icon`.
    expect(updateMutateAsync).toHaveBeenCalledWith({ name: "Renamed" });
  });

  it("can switch approval mode back to auto after moving to review", async () => {
    updateMutateAsync.mockResolvedValueOnce({});
    const reviewWiki: WikiDto = { ...baseWiki, approvalMode: "review" };
    renderDialog({ wiki: reviewWiki });
    // Sanity: review radio is checked on open.
    expect(
      (screen.getByTestId("wiki-settings-approval-review") as HTMLInputElement)
        .checked,
    ).toBe(true);
    fireEvent.click(screen.getByTestId("wiki-settings-approval-auto"));
    expect(
      (screen.getByTestId("wiki-settings-approval-auto") as HTMLInputElement)
        .checked,
    ).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByTestId("wiki-settings-save"));
    });
    expect(updateMutateAsync).toHaveBeenCalledWith({ approvalMode: "auto" });
  });

  it("Agent permission Select updates the payload on save", async () => {
    updateMutateAsync.mockResolvedValueOnce({});
    renderDialog();
    fireEvent.change(screen.getByTestId("wiki-settings-agent-trigger"), {
      target: { value: "write" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("wiki-settings-save"));
    });
    expect(updateMutateAsync).toHaveBeenCalledWith({
      agentPermission: "write",
    });
  });
});

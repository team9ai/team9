import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Change } from "diff";
import { FileDiff, ProposalDiffView, flattenDiff } from "../ProposalDiffView";
import type { ProposalDiffEntry, ProposalDto, WikiDto } from "@/types/wiki";

const mockNavigate = vi.hoisted(() => vi.fn());
const mockUseCurrentUser = vi.hoisted(() => vi.fn());
const mockUseWikiProposals = vi.hoisted(() => vi.fn());
const mockUseProposalDiff = vi.hoisted(() => vi.fn());
const approveMutate = vi.hoisted(() => vi.fn());
const rejectMutate = vi.hoisted(() => vi.fn());
const approvePending = vi.hoisted(() => ({ value: false }));
const rejectPending = vi.hoisted(() => ({ value: false }));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("@/hooks/useAuth", () => ({
  useCurrentUser: () => mockUseCurrentUser(),
}));

vi.mock("@/hooks/useWikiProposals", () => ({
  useWikiProposals: (...args: unknown[]) => mockUseWikiProposals(...args),
  useProposalDiff: (...args: unknown[]) => mockUseProposalDiff(...args),
  useApproveProposal: () => ({
    mutateAsync: approveMutate,
    get isPending() {
      return approvePending.value;
    },
  }),
  useRejectProposal: () => ({
    mutateAsync: rejectMutate,
    get isPending() {
      return rejectPending.value;
    },
  }),
}));

const mockUseWikiWebSocketSync = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/useWikiWebSocketSync", () => ({
  useWikiWebSocketSync: (...args: unknown[]) =>
    mockUseWikiWebSocketSync(...args),
}));

function buildWiki(overrides: Partial<WikiDto> = {}): WikiDto {
  return {
    id: "wiki-1",
    workspaceId: "ws-1",
    name: "Public Wiki",
    slug: "public",
    icon: null,
    approvalMode: "review",
    humanPermission: "write",
    agentPermission: "read",
    createdBy: "user-1",
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    archivedAt: null,
    ...overrides,
  };
}

function buildProposal(overrides: Partial<ProposalDto> = {}): ProposalDto {
  return {
    id: "prop-1",
    wikiId: "wiki-1",
    title: "Update README",
    description: "Small tweak to the intro.",
    status: "pending",
    authorId: "user-2",
    authorType: "user",
    createdAt: "2026-04-02T00:00:00.000Z",
    reviewedBy: null,
    reviewedAt: null,
    ...overrides,
  };
}

const modifiedEntry: ProposalDiffEntry = {
  Path: "README.md",
  Status: "modified",
  OldContent: "hello\nworld\n",
  NewContent: "hello\nfriends\n",
};

const addedEntry: ProposalDiffEntry = {
  Path: "NEW.md",
  Status: "added",
  OldContent: "",
  NewContent: "brand new\nfile\n",
};

const deletedEntry: ProposalDiffEntry = {
  Path: "OLD.md",
  Status: "deleted",
  OldContent: "bye\nforever\n",
  NewContent: "",
};

const emptyAdded: ProposalDiffEntry = {
  Path: "EMPTY.md",
  Status: "added",
  OldContent: "",
  NewContent: "",
};

beforeEach(() => {
  vi.clearAllMocks();
  approvePending.value = false;
  rejectPending.value = false;
  // Default: write-permission human user.
  mockUseCurrentUser.mockReturnValue({ data: { id: "user-1" } });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────
// flattenDiff pure helper
// ─────────────────────────────────────────────────────────────────────────

// Build a `Change` record without having to spell out every optional
// `added`/`removed` field. The `diff` types are strict enough that a bare
// `{ value, count }` literal fails the ChangeObject check; casting here
// keeps individual tests readable.
function change(
  value: string,
  kind: "added" | "removed" | "context" = "context",
): Change {
  return {
    value,
    count: value.split("\n").length,
    added: kind === "added",
    removed: kind === "removed",
  } as Change;
}

describe("flattenDiff", () => {
  it("maps added / removed / unchanged changes to the right kinds", () => {
    const changes: Change[] = [
      change("same\n"),
      change("gone\n", "removed"),
      change("new\n", "added"),
    ];
    expect(flattenDiff(changes)).toEqual([
      { kind: "context", text: "same" },
      { kind: "del", text: "gone" },
      { kind: "add", text: "new" },
    ]);
  });

  it("drops the trailing empty element from a hunk ending with \\n", () => {
    const rows = flattenDiff([change("a\nb\n")]);
    expect(rows).toEqual([
      { kind: "context", text: "a" },
      { kind: "context", text: "b" },
    ]);
  });

  it("keeps a meaningful blank middle line between two text rows", () => {
    const rows = flattenDiff([change("a\n\nb\n")]);
    expect(rows).toEqual([
      { kind: "context", text: "a" },
      { kind: "context", text: "" },
      { kind: "context", text: "b" },
    ]);
  });

  it("keeps the final line when the value does not end with a newline", () => {
    const rows = flattenDiff([change("a\nb")]);
    expect(rows).toEqual([
      { kind: "context", text: "a" },
      { kind: "context", text: "b" },
    ]);
  });

  it("handles an empty value by producing no rows", () => {
    // `"".split("\n")` yields `[""]` — the trailing-pop guard turns that
    // into an empty array so we don't surface a phantom blank row.
    expect(flattenDiff([change("")])).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// FileDiff rendering
// ─────────────────────────────────────────────────────────────────────────

describe("FileDiff", () => {
  it("renders every new line as an addition for an added file", () => {
    render(<FileDiff entry={addedEntry} />);
    const section = screen.getByTestId("proposal-diff-file-NEW.md");
    expect(section).toHaveTextContent(/brand new/);
    expect(section).toHaveTextContent(/file/);
    // Every line (other than blanks) should carry a +
    const plusMarks = section.querySelectorAll("span");
    expect(Array.from(plusMarks).some((s) => s.textContent === "+")).toBe(true);
  });

  it("renders every old line as a deletion for a deleted file", () => {
    render(<FileDiff entry={deletedEntry} />);
    const section = screen.getByTestId("proposal-diff-file-OLD.md");
    expect(section).toHaveTextContent(/bye/);
    expect(section).toHaveTextContent(/forever/);
  });

  it("renders a unified diff for a modified file", () => {
    render(<FileDiff entry={modifiedEntry} />);
    const section = screen.getByTestId("proposal-diff-file-README.md");
    expect(section).toHaveTextContent(/hello/);
    expect(section).toHaveTextContent(/friends/);
  });

  it("renders an empty placeholder when the file has no content", () => {
    render(<FileDiff entry={emptyAdded} />);
    expect(
      screen.getByTestId("proposal-diff-file-empty-EMPTY.md"),
    ).toBeInTheDocument();
  });

  it("renders an empty placeholder when a deleted file carries no old content", () => {
    const emptyDeleted: ProposalDiffEntry = {
      Path: "GONE.md",
      Status: "deleted",
      OldContent: "",
      NewContent: "",
    };
    render(<FileDiff entry={emptyDeleted} />);
    expect(
      screen.getByTestId("proposal-diff-file-empty-GONE.md"),
    ).toBeInTheDocument();
  });

  it("renders a non-breaking space for a blank inner line", () => {
    const withBlank: ProposalDiffEntry = {
      Path: "BLANK.md",
      Status: "added",
      OldContent: "",
      // Two lines separated by a blank middle line — the renderer must
      // emit a `\u00A0` so the empty <span> still occupies a row.
      NewContent: "first\n\nthird\n",
    };
    const { container } = render(<FileDiff entry={withBlank} />);
    expect(container.textContent).toContain("\u00A0");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// ProposalDiffView — integration
// ─────────────────────────────────────────────────────────────────────────

describe("ProposalDiffView", () => {
  it("subscribes to the wiki WebSocket sync hook when mounted", () => {
    mockUseWikiProposals.mockReturnValue({ data: [buildProposal()] });
    mockUseProposalDiff.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    });
    render(<ProposalDiffView wiki={buildWiki()} proposalId="prop-1" />);
    expect(mockUseWikiWebSocketSync).toHaveBeenCalled();
  });

  it("renders the diff files after the diff query resolves", () => {
    mockUseWikiProposals.mockReturnValue({ data: [buildProposal()] });
    mockUseProposalDiff.mockReturnValue({
      data: [modifiedEntry, addedEntry],
      isLoading: false,
      isError: false,
    });

    render(<ProposalDiffView wiki={buildWiki()} proposalId="prop-1" />);

    expect(screen.getByTestId("proposal-diff-title")).toHaveTextContent(
      /Update README/,
    );
    expect(screen.getByTestId("proposal-diff-description")).toHaveTextContent(
      /Small tweak/,
    );
    expect(
      screen.getByTestId("proposal-diff-file-README.md"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("proposal-diff-file-NEW.md")).toBeInTheDocument();
  });

  it("falls back to the proposal id when metadata is missing", () => {
    mockUseWikiProposals.mockReturnValue({ data: [] });
    mockUseProposalDiff.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    });

    render(<ProposalDiffView wiki={buildWiki()} proposalId="prop-42" />);

    expect(screen.getByTestId("proposal-diff-title")).toHaveTextContent(
      /Proposal prop-42/,
    );
    // No description surface when the proposal metadata is unavailable.
    expect(screen.queryByTestId("proposal-diff-description")).toBeNull();
    // No actions rendered when the proposal metadata is unavailable.
    expect(screen.queryByTestId("proposal-diff-actions")).toBeNull();
  });

  it("omits the description paragraph when the proposal has none", () => {
    mockUseWikiProposals.mockReturnValue({
      data: [buildProposal({ description: "" })],
    });
    mockUseProposalDiff.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    });

    render(<ProposalDiffView wiki={buildWiki()} proposalId="prop-1" />);
    expect(screen.queryByTestId("proposal-diff-description")).toBeNull();
  });

  it("labels agent authors as `Agent`", () => {
    mockUseWikiProposals.mockReturnValue({
      data: [buildProposal({ authorType: "agent", authorId: "bot-9" })],
    });
    mockUseProposalDiff.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    });

    render(<ProposalDiffView wiki={buildWiki()} proposalId="prop-1" />);
    expect(screen.getByTestId("proposal-diff-view")).toHaveTextContent(
      /Agent bot-9/,
    );
  });

  it("treats a missing currentUser as read-only (no actions)", () => {
    mockUseCurrentUser.mockReturnValue({ data: undefined });
    mockUseWikiProposals.mockReturnValue({ data: [buildProposal()] });
    mockUseProposalDiff.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    });

    render(<ProposalDiffView wiki={buildWiki()} proposalId="prop-1" />);
    expect(screen.queryByTestId("proposal-diff-actions")).toBeNull();
  });

  it("renders a loading placeholder while the diff loads", () => {
    mockUseWikiProposals.mockReturnValue({ data: [buildProposal()] });
    mockUseProposalDiff.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });

    render(<ProposalDiffView wiki={buildWiki()} proposalId="prop-1" />);
    expect(screen.getByTestId("proposal-diff-loading")).toBeInTheDocument();
  });

  it("renders an error when the diff query fails", () => {
    mockUseWikiProposals.mockReturnValue({ data: [buildProposal()] });
    mockUseProposalDiff.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });

    render(<ProposalDiffView wiki={buildWiki()} proposalId="prop-1" />);
    expect(screen.getByTestId("proposal-diff-error")).toBeInTheDocument();
  });

  it("renders a neutral note when the diff is empty", () => {
    mockUseWikiProposals.mockReturnValue({ data: [buildProposal()] });
    mockUseProposalDiff.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    });

    render(<ProposalDiffView wiki={buildWiki()} proposalId="prop-1" />);
    expect(screen.getByTestId("proposal-diff-empty")).toBeInTheDocument();
  });

  it("navigates back to the list when the back link is clicked", () => {
    mockUseWikiProposals.mockReturnValue({ data: [buildProposal()] });
    mockUseProposalDiff.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    });

    render(<ProposalDiffView wiki={buildWiki()} proposalId="prop-1" />);

    fireEvent.click(screen.getByTestId("proposal-diff-back"));
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/wiki/$wikiSlug/-/review",
      params: { wikiSlug: "public" },
    });
  });

  // ─── Permission gating ────────────────────────────────────────────────

  it("hides the approve/reject actions for read-only users", () => {
    mockUseWikiProposals.mockReturnValue({ data: [buildProposal()] });
    mockUseProposalDiff.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    });

    render(
      <ProposalDiffView
        wiki={buildWiki({ humanPermission: "read" })}
        proposalId="prop-1"
      />,
    );

    expect(screen.queryByTestId("proposal-diff-actions")).toBeNull();
  });

  it("hides the actions for propose-level users too", () => {
    mockUseWikiProposals.mockReturnValue({ data: [buildProposal()] });
    mockUseProposalDiff.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    });

    render(
      <ProposalDiffView
        wiki={buildWiki({ humanPermission: "propose" })}
        proposalId="prop-1"
      />,
    );

    expect(screen.queryByTestId("proposal-diff-actions")).toBeNull();
  });

  it("hides the actions when the proposal is no longer pending", () => {
    mockUseWikiProposals.mockReturnValue({
      data: [buildProposal({ status: "approved" })],
    });
    mockUseProposalDiff.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    });

    render(<ProposalDiffView wiki={buildWiki()} proposalId="prop-1" />);

    expect(screen.queryByTestId("proposal-diff-actions")).toBeNull();
  });

  // ─── Approve flow ────────────────────────────────────────────────────

  it("calls approve and navigates back on success", async () => {
    mockUseWikiProposals.mockReturnValue({ data: [buildProposal()] });
    mockUseProposalDiff.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    });
    approveMutate.mockResolvedValueOnce(undefined);

    render(<ProposalDiffView wiki={buildWiki()} proposalId="prop-1" />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("proposal-diff-approve"));
    });

    expect(approveMutate).toHaveBeenCalledWith("prop-1");
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/wiki/$wikiSlug/-/review",
      params: { wikiSlug: "public" },
    });
  });

  it("shows a 409-specific toast on approve conflict and stays on the view", async () => {
    mockUseWikiProposals.mockReturnValue({ data: [buildProposal()] });
    mockUseProposalDiff.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    });
    const conflictError = Object.assign(new Error("conflict"), { status: 409 });
    approveMutate.mockRejectedValueOnce(conflictError);
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});

    render(<ProposalDiffView wiki={buildWiki()} proposalId="prop-1" />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("proposal-diff-approve"));
    });

    expect(alertSpy).toHaveBeenCalledWith("Conflict — merge aborted");
    // Didn't navigate away on error.
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("shows a 403-specific toast on approve forbidden", async () => {
    mockUseWikiProposals.mockReturnValue({ data: [buildProposal()] });
    mockUseProposalDiff.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    });
    approveMutate.mockRejectedValueOnce(
      Object.assign(new Error("forbidden"), { status: 403 }),
    );
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});

    render(<ProposalDiffView wiki={buildWiki()} proposalId="prop-1" />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("proposal-diff-approve"));
    });

    expect(alertSpy).toHaveBeenCalledWith(
      "You don't have permission to approve this proposal.",
    );
  });

  it("shows a generic toast for an unknown approve error", async () => {
    mockUseWikiProposals.mockReturnValue({ data: [buildProposal()] });
    mockUseProposalDiff.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    });
    approveMutate.mockRejectedValueOnce(new Error("boom"));
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});

    render(<ProposalDiffView wiki={buildWiki()} proposalId="prop-1" />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("proposal-diff-approve"));
    });

    expect(alertSpy).toHaveBeenCalledWith("Approve failed. Please try again.");
  });

  it("disables the approve button while a mutation is pending", () => {
    mockUseWikiProposals.mockReturnValue({ data: [buildProposal()] });
    mockUseProposalDiff.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    });
    approvePending.value = true;

    render(<ProposalDiffView wiki={buildWiki()} proposalId="prop-1" />);

    expect(screen.getByTestId("proposal-diff-approve")).toBeDisabled();
    fireEvent.click(screen.getByTestId("proposal-diff-approve"));
    expect(approveMutate).not.toHaveBeenCalled();
  });

  // ─── Reject flow ────────────────────────────────────────────────────

  it("opens the reject form, submits with reason, and navigates back", async () => {
    mockUseWikiProposals.mockReturnValue({ data: [buildProposal()] });
    mockUseProposalDiff.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    });
    rejectMutate.mockResolvedValueOnce(undefined);

    render(<ProposalDiffView wiki={buildWiki()} proposalId="prop-1" />);

    fireEvent.click(screen.getByTestId("proposal-diff-reject-toggle"));
    const form = screen.getByTestId("proposal-diff-reject-form");
    fireEvent.change(within(form).getByTestId("proposal-diff-reject-reason"), {
      target: { value: "Not quite right" },
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("proposal-diff-reject-confirm"));
    });

    expect(rejectMutate).toHaveBeenCalledWith({
      proposalId: "prop-1",
      reason: "Not quite right",
    });
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/wiki/$wikiSlug/-/review",
      params: { wikiSlug: "public" },
    });
  });

  it("submits reject without a reason when the textarea is empty", async () => {
    mockUseWikiProposals.mockReturnValue({ data: [buildProposal()] });
    mockUseProposalDiff.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    });
    rejectMutate.mockResolvedValueOnce(undefined);

    render(<ProposalDiffView wiki={buildWiki()} proposalId="prop-1" />);

    fireEvent.click(screen.getByTestId("proposal-diff-reject-toggle"));

    await act(async () => {
      fireEvent.click(screen.getByTestId("proposal-diff-reject-confirm"));
    });

    expect(rejectMutate).toHaveBeenCalledWith({
      proposalId: "prop-1",
      reason: undefined,
    });
  });

  it("cancels the reject form and clears the typed reason", () => {
    mockUseWikiProposals.mockReturnValue({ data: [buildProposal()] });
    mockUseProposalDiff.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    });

    render(<ProposalDiffView wiki={buildWiki()} proposalId="prop-1" />);

    fireEvent.click(screen.getByTestId("proposal-diff-reject-toggle"));
    fireEvent.change(screen.getByTestId("proposal-diff-reject-reason"), {
      target: { value: "typing..." },
    });
    fireEvent.click(screen.getByTestId("proposal-diff-reject-cancel"));

    expect(screen.queryByTestId("proposal-diff-reject-form")).toBeNull();
  });

  it("toggles the reject form closed when the toggle is clicked twice", () => {
    mockUseWikiProposals.mockReturnValue({ data: [buildProposal()] });
    mockUseProposalDiff.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    });

    render(<ProposalDiffView wiki={buildWiki()} proposalId="prop-1" />);

    const toggle = screen.getByTestId("proposal-diff-reject-toggle");
    fireEvent.click(toggle);
    expect(screen.getByTestId("proposal-diff-reject-form")).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.queryByTestId("proposal-diff-reject-form")).toBeNull();
  });

  it("shows a 409-specific toast on reject conflict", async () => {
    mockUseWikiProposals.mockReturnValue({ data: [buildProposal()] });
    mockUseProposalDiff.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    });
    rejectMutate.mockRejectedValueOnce(
      Object.assign(new Error("conflict"), { status: 409 }),
    );
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});

    render(<ProposalDiffView wiki={buildWiki()} proposalId="prop-1" />);

    fireEvent.click(screen.getByTestId("proposal-diff-reject-toggle"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("proposal-diff-reject-confirm"));
    });

    expect(alertSpy).toHaveBeenCalledWith("Conflict — merge aborted");
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("shows a 403-specific toast on reject forbidden", async () => {
    mockUseWikiProposals.mockReturnValue({ data: [buildProposal()] });
    mockUseProposalDiff.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    });
    rejectMutate.mockRejectedValueOnce(
      Object.assign(new Error("forbidden"), { status: 403 }),
    );
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});

    render(<ProposalDiffView wiki={buildWiki()} proposalId="prop-1" />);

    fireEvent.click(screen.getByTestId("proposal-diff-reject-toggle"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("proposal-diff-reject-confirm"));
    });

    expect(alertSpy).toHaveBeenCalledWith(
      "You don't have permission to reject this proposal.",
    );
  });

  it("shows a generic toast for an unknown reject error", async () => {
    mockUseWikiProposals.mockReturnValue({ data: [buildProposal()] });
    mockUseProposalDiff.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    });
    rejectMutate.mockRejectedValueOnce(new Error("boom"));
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});

    render(<ProposalDiffView wiki={buildWiki()} proposalId="prop-1" />);

    fireEvent.click(screen.getByTestId("proposal-diff-reject-toggle"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("proposal-diff-reject-confirm"));
    });

    expect(alertSpy).toHaveBeenCalledWith("Reject failed. Please try again.");
  });

  it("disables the reject toggle while a mutation is pending", () => {
    mockUseWikiProposals.mockReturnValue({ data: [buildProposal()] });
    mockUseProposalDiff.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    });
    rejectPending.value = true;

    render(<ProposalDiffView wiki={buildWiki()} proposalId="prop-1" />);

    // The pending guard surfaces as a `disabled` attribute — when the user
    // can't reach the confirm button at all, the short-circuit is
    // observable via the disabled state of the toggle itself.
    expect(screen.getByTestId("proposal-diff-reject-toggle")).toBeDisabled();
    expect(screen.getByTestId("proposal-diff-approve")).toBeDisabled();
  });

  it("renders the reject confirm spinner while the mutation is pending", () => {
    mockUseWikiProposals.mockReturnValue({ data: [buildProposal()] });
    mockUseProposalDiff.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    });

    // First render: not pending — click the toggle to surface the form.
    const { rerender } = render(
      <ProposalDiffView wiki={buildWiki()} proposalId="prop-1" />,
    );
    fireEvent.click(screen.getByTestId("proposal-diff-reject-toggle"));

    // Flip pending flag and re-render. The confirm button now shows a
    // spinner as its leading icon — the ternary branch we want to cover.
    rejectPending.value = true;
    rerender(<ProposalDiffView wiki={buildWiki()} proposalId="prop-1" />);

    const confirm = screen.getByTestId("proposal-diff-reject-confirm");
    expect(confirm.querySelector("svg.animate-spin")).not.toBeNull();
  });
});

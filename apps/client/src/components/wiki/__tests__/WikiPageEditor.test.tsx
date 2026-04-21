import { useEffect } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PageDto, WikiDto } from "@/types/wiki";

// --- Mocks ---------------------------------------------------------------
//
// We swap out the heavyweight leaves so the tests exercise only the
// composite's own wiring:
//  - `DocumentEditor` → a textarea that forwards `onChange`.
//  - `IconPickerPopover` / `CoverPickerPopover` → buttons we can click to
//    stage controlled emissions, and an indicator of their `disabled` prop.
//  - `useWikiDraft` → a jest-controlled spy so we can force specific
//    draft / staleness combinations.
//  - `useCurrentUser` → a stub with a per-test variable.

const documentEditorProps = vi.hoisted(() =>
  vi.fn<(props: Record<string, unknown>) => void>(),
);

// Mount/unmount counters let us verify that DocumentEditor is actually
// remounted on re-seed events (via a `key` change) and, conversely, that
// it stays mounted during normal user typing. React's `key` prop is
// absorbed by React itself and not passed to the child, so we have to
// reason about identity via effect timing.
const documentEditorMounts = vi.hoisted(() => ({ count: 0 }));
const documentEditorUnmounts = vi.hoisted(() => ({ count: 0 }));

const iconPickerProps = vi.hoisted(() =>
  vi.fn<(props: Record<string, unknown>) => void>(),
);

const coverPickerProps = vi.hoisted(() =>
  vi.fn<(props: Record<string, unknown>) => void>(),
);

vi.mock("@/components/documents/DocumentEditor", () => ({
  DocumentEditor: (props: {
    initialContent?: string;
    onChange?: (md: string) => void;
    readOnly?: boolean;
  }) => {
    documentEditorProps(props);
    useEffect(() => {
      documentEditorMounts.count += 1;
      return () => {
        documentEditorUnmounts.count += 1;
      };
      // Run once per mount instance; empty deps is intentional.
    }, []);
    return (
      <textarea
        data-testid="doc-editor"
        data-readonly={props.readOnly ? "true" : "false"}
        defaultValue={props.initialContent ?? ""}
        readOnly={!!props.readOnly}
        onChange={(e) => props.onChange?.(e.target.value)}
      />
    );
  },
}));

vi.mock("../IconPickerPopover", () => ({
  IconPickerPopover: (props: {
    value?: string;
    onChange: (icon: string) => void;
    disabled?: boolean;
  }) => {
    iconPickerProps(props);
    return (
      <button
        type="button"
        data-testid="mock-icon-picker"
        data-value={props.value ?? ""}
        data-disabled={props.disabled ? "true" : "false"}
        disabled={props.disabled}
        onClick={() => props.onChange("🎨")}
      >
        icon-picker
      </button>
    );
  },
}));

vi.mock("../CoverPickerPopover", () => ({
  CoverPickerPopover: (props: {
    wikiId: string;
    value?: string;
    onChange: (cover: string) => void;
    disabled?: boolean;
  }) => {
    coverPickerProps(props);
    return (
      <div>
        <button
          type="button"
          data-testid="mock-cover-picker"
          data-wiki-id={props.wikiId}
          data-value={props.value ?? ""}
          data-disabled={props.disabled ? "true" : "false"}
          disabled={props.disabled}
          onClick={() => props.onChange("attachments/new.jpg")}
        >
          cover-picker
        </button>
        <button
          type="button"
          data-testid="mock-cover-remove"
          disabled={props.disabled}
          onClick={() => props.onChange("")}
        >
          cover-remove
        </button>
      </div>
    );
  },
}));

type DraftState = {
  draft: { body: string; frontmatter: Record<string, unknown> } | null;
  setDraft: ReturnType<typeof vi.fn>;
  clearDraft: ReturnType<typeof vi.fn>;
  isDirty: boolean;
  hasStaleAlert: boolean;
  dismissStaleAlert: ReturnType<typeof vi.fn>;
};

const draftHook = vi.hoisted(() => ({
  state: null as DraftState | null,
}));

vi.mock("@/hooks/useWikiDraft", () => ({
  useWikiDraft: () => draftHook.state,
}));

const currentUserMock = vi.hoisted(() => ({
  data: { id: "user-1", userType: "human" } as unknown as {
    id: string;
    userType?: string;
  } | null,
}));

vi.mock("@/hooks/useAuth", () => ({
  useCurrentUser: () => ({ data: currentUserMock.data }),
}));

// Commit mutation — lets each test stub the mutateAsync resolution or
// rejection plus the pending flag surfaced to the status bar.
const commitHook = vi.hoisted(() => ({
  mutateAsync:
    vi.fn<
      (
        input: unknown,
      ) => Promise<{ commit: { sha: string }; proposal: { id: string } | null }>
    >(),
  isPending: false,
}));

vi.mock("@/hooks/useWikiPage", () => ({
  useCommitWikiPage: () => ({
    mutateAsync: commitHook.mutateAsync,
    isPending: commitHook.isPending,
  }),
}));

// Image upload hook — we only care about the contract the editor calls.
// The hook's own coverage is owned by `useWikiImageUpload.test.ts`.
const imageUploadHook = vi.hoisted(() => ({
  upload: vi.fn<(file: File, basePath: string) => Promise<string>>(),
  uploading: false,
}));
vi.mock("@/hooks/useWikiImageUpload", () => ({
  useWikiImageUpload: () => ({
    upload: imageUploadHook.upload,
    uploading: imageUploadHook.uploading,
  }),
}));

// Wiki store action spy — we never touch the real store from these tests.
const setSubmittedProposalSpy = vi.hoisted(() => vi.fn());
vi.mock("@/stores/useWikiStore", () => ({
  wikiActions: {
    setSubmittedProposal: (...args: unknown[]) =>
      setSubmittedProposalSpy(...args),
  },
}));

// SubmitForReviewDialog — minimal stub that exposes the controlled props
// + fires a deterministic input when the test clicks `submit`. Keeps the
// file focused on the editor's own save flow.
const submitForReviewProps = vi.hoisted(() =>
  vi.fn<(props: Record<string, unknown>) => void>(),
);

vi.mock("../SubmitForReviewDialog", () => ({
  SubmitForReviewDialog: (props: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSubmit: (input: { title: string; description?: string }) => void;
    isSubmitting?: boolean;
  }) => {
    submitForReviewProps(props);
    if (!props.open) return null;
    return (
      <div data-testid="mock-review-dialog">
        <button
          type="button"
          data-testid="mock-review-submit"
          onClick={() =>
            props.onSubmit({
              title: "Fix typo",
              description: "misspelled",
            })
          }
        >
          submit
        </button>
        <button
          type="button"
          data-testid="mock-review-cancel"
          onClick={() => props.onOpenChange(false)}
        >
          cancel
        </button>
      </div>
    );
  },
}));

// --- SUT -----------------------------------------------------------------

import { WikiPageEditor } from "../WikiPageEditor";

const baseWiki: WikiDto = {
  id: "wiki-1",
  workspaceId: "ws-1",
  name: "Handbook",
  slug: "handbook",
  icon: null,
  approvalMode: "auto",
  humanPermission: "write",
  agentPermission: "read",
  createdBy: "user-1",
  createdAt: "2026-04-01T00:00:00.000Z",
  updatedAt: "2026-04-01T00:00:00.000Z",
  archivedAt: null,
};

const basePage: PageDto = {
  path: "index.md",
  content: "server body",
  frontmatter: { icon: "🚀", title: "Home" },
  lastCommit: {
    sha: "abc",
    author: "winrey",
    timestamp: "2026-04-15T00:00:00.000Z",
  },
};

function makeDraftState(overrides: Partial<DraftState> = {}): DraftState {
  return {
    draft: null,
    setDraft: vi.fn(),
    clearDraft: vi.fn(),
    isDirty: false,
    hasStaleAlert: false,
    dismissStaleAlert: vi.fn(),
    ...overrides,
  };
}

async function click(el: HTMLElement) {
  await act(async () => {
    fireEvent.click(el);
  });
}

beforeEach(() => {
  documentEditorProps.mockReset();
  iconPickerProps.mockReset();
  coverPickerProps.mockReset();
  submitForReviewProps.mockReset();
  setSubmittedProposalSpy.mockReset();
  commitHook.mutateAsync.mockReset();
  commitHook.mutateAsync.mockResolvedValue({
    commit: { sha: "new-sha" },
    proposal: null,
  });
  commitHook.isPending = false;
  imageUploadHook.upload.mockReset();
  imageUploadHook.upload.mockResolvedValue("attachments/mock-uuid.png");
  imageUploadHook.uploading = false;
  documentEditorMounts.count = 0;
  documentEditorUnmounts.count = 0;
  currentUserMock.data = {
    id: "user-1",
    userType: "human",
  } as unknown as { id: string; userType?: string };
  draftHook.state = makeDraftState();
});

describe("WikiPageEditor", () => {
  it("renders the editor with server content when no draft exists", () => {
    render(
      <WikiPageEditor
        wikiId="wiki-1"
        path="index.md"
        serverPage={basePage}
        wiki={baseWiki}
      />,
    );
    const editor = screen.getByTestId("doc-editor") as HTMLTextAreaElement;
    expect(editor.defaultValue).toBe("server body");
    expect(editor.dataset.readonly).toBe("false");
    expect(screen.getByTestId("mock-icon-picker")).toHaveAttribute(
      "data-value",
      "🚀",
    );
    expect(screen.getByTestId("mock-cover-picker")).toHaveAttribute(
      "data-value",
      "",
    );
  });

  it("seeds from draft when a draft is present", () => {
    draftHook.state = makeDraftState({
      draft: {
        body: "draft body",
        frontmatter: { icon: "🦊", title: "Drafted" },
      },
      isDirty: true,
    });
    render(
      <WikiPageEditor
        wikiId="wiki-1"
        path="index.md"
        serverPage={basePage}
        wiki={baseWiki}
      />,
    );
    expect(
      (screen.getByTestId("doc-editor") as HTMLTextAreaElement).defaultValue,
    ).toBe("draft body");
    expect(screen.getByTestId("mock-icon-picker")).toHaveAttribute(
      "data-value",
      "🦊",
    );
  });

  it("forwards coverPath from frontmatter when set", () => {
    render(
      <WikiPageEditor
        wikiId="wiki-1"
        path="index.md"
        serverPage={{
          ...basePage,
          frontmatter: { ...basePage.frontmatter, cover: "attachments/c.jpg" },
        }}
        wiki={baseWiki}
      />,
    );
    expect(screen.getByTestId("mock-cover-picker")).toHaveAttribute(
      "data-value",
      "attachments/c.jpg",
    );
  });

  it("ignores a non-string icon/cover in frontmatter", () => {
    render(
      <WikiPageEditor
        wikiId="wiki-1"
        path="index.md"
        serverPage={{
          ...basePage,
          frontmatter: { icon: 123, cover: false },
        }}
        wiki={baseWiki}
      />,
    );
    expect(screen.getByTestId("mock-icon-picker")).toHaveAttribute(
      "data-value",
      "",
    );
    expect(screen.getByTestId("mock-cover-picker")).toHaveAttribute(
      "data-value",
      "",
    );
  });

  it("updates body and calls setDraft on body change", async () => {
    const setDraft = vi.fn();
    draftHook.state = makeDraftState({ setDraft });
    render(
      <WikiPageEditor
        wikiId="wiki-1"
        path="index.md"
        serverPage={basePage}
        wiki={baseWiki}
      />,
    );
    const editor = screen.getByTestId("doc-editor") as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(editor, { target: { value: "new body" } });
    });
    expect(setDraft).toHaveBeenCalledTimes(1);
    expect(setDraft).toHaveBeenCalledWith({
      body: "new body",
      frontmatter: basePage.frontmatter,
    });
  });

  it("updates frontmatter and calls setDraft when icon picker fires", async () => {
    const setDraft = vi.fn();
    draftHook.state = makeDraftState({ setDraft });
    render(
      <WikiPageEditor
        wikiId="wiki-1"
        path="index.md"
        serverPage={basePage}
        wiki={baseWiki}
      />,
    );
    await click(screen.getByTestId("mock-icon-picker"));
    expect(setDraft).toHaveBeenCalledWith({
      body: basePage.content,
      frontmatter: { ...basePage.frontmatter, icon: "🎨" },
    });
  });

  it("applies cover via the cover picker", async () => {
    const setDraft = vi.fn();
    draftHook.state = makeDraftState({ setDraft });
    render(
      <WikiPageEditor
        wikiId="wiki-1"
        path="index.md"
        serverPage={basePage}
        wiki={baseWiki}
      />,
    );
    await click(screen.getByTestId("mock-cover-picker"));
    expect(setDraft).toHaveBeenCalledWith({
      body: basePage.content,
      frontmatter: { ...basePage.frontmatter, cover: "attachments/new.jpg" },
    });
  });

  it("removes cover (strips the key) when cover onChange fires with empty string", async () => {
    const setDraft = vi.fn();
    draftHook.state = makeDraftState({ setDraft });
    render(
      <WikiPageEditor
        wikiId="wiki-1"
        path="index.md"
        serverPage={{
          ...basePage,
          frontmatter: { ...basePage.frontmatter, cover: "attachments/c.jpg" },
        }}
        wiki={baseWiki}
      />,
    );
    await click(screen.getByTestId("mock-cover-remove"));
    expect(setDraft).toHaveBeenCalledTimes(1);
    const [payload] = setDraft.mock.calls[0];
    expect(payload.frontmatter).not.toHaveProperty("cover");
    expect(payload.frontmatter).toMatchObject({
      icon: "🚀",
      title: "Home",
    });
  });

  it("renders in read-only mode when permission is 'read' (human with read perm)", async () => {
    const setDraft = vi.fn();
    draftHook.state = makeDraftState({ setDraft });
    render(
      <WikiPageEditor
        wikiId="wiki-1"
        path="index.md"
        serverPage={basePage}
        wiki={{ ...baseWiki, humanPermission: "read" }}
      />,
    );
    expect(screen.getByTestId("doc-editor")).toHaveAttribute(
      "data-readonly",
      "true",
    );
    expect(screen.getByTestId("mock-icon-picker")).toBeDisabled();
    expect(screen.getByTestId("mock-cover-picker")).toBeDisabled();

    // Even if a (mis)behaving child forced onClick through, setDraft should
    // not fire because we guarded handleFrontmatterChange with `readOnly`.
    // (Real disabled buttons won't emit the click in jsdom at all.)
    await click(screen.getByTestId("mock-icon-picker"));
    expect(setDraft).not.toHaveBeenCalled();
  });

  it("renders in read-only mode when the user is absent", () => {
    currentUserMock.data = null;
    render(
      <WikiPageEditor
        wikiId="wiki-1"
        path="index.md"
        serverPage={basePage}
        wiki={baseWiki}
      />,
    );
    expect(screen.getByTestId("doc-editor")).toHaveAttribute(
      "data-readonly",
      "true",
    );
  });

  it("shows the stale alert banner when hasStaleAlert is true and dismisses it", async () => {
    const dismissStaleAlert = vi.fn();
    draftHook.state = makeDraftState({
      hasStaleAlert: true,
      dismissStaleAlert,
    });
    render(
      <WikiPageEditor
        wikiId="wiki-1"
        path="index.md"
        serverPage={basePage}
        wiki={baseWiki}
      />,
    );
    const alert = screen.getByTestId("wiki-page-stale-alert");
    expect(alert).toHaveTextContent(/unsaved local changes/i);
    await click(screen.getByTestId("wiki-page-stale-alert-dismiss"));
    expect(dismissStaleAlert).toHaveBeenCalledTimes(1);
  });

  it("hides the stale alert banner when hasStaleAlert is false", () => {
    render(
      <WikiPageEditor
        wikiId="wiki-1"
        path="index.md"
        serverPage={basePage}
        wiki={baseWiki}
      />,
    );
    expect(screen.queryByTestId("wiki-page-stale-alert")).toBeNull();
  });

  it("does NOT reset local state when serverPage changes while dirty", async () => {
    const setDraft = vi.fn();
    // Start clean — first render seeds from serverPage.
    draftHook.state = makeDraftState({ setDraft, isDirty: false });
    const { rerender } = render(
      <WikiPageEditor
        wikiId="wiki-1"
        path="index.md"
        serverPage={basePage}
        wiki={baseWiki}
      />,
    );
    const editor = screen.getByTestId("doc-editor") as HTMLTextAreaElement;
    expect(editor.defaultValue).toBe("server body");

    // Simulate user typing → flip to dirty.
    await act(async () => {
      fireEvent.change(editor, { target: { value: "dirty body" } });
    });
    draftHook.state = makeDraftState({
      setDraft,
      isDirty: true,
      draft: {
        body: "dirty body",
        frontmatter: basePage.frontmatter,
      },
    });

    // Push a new server page. Because isDirty=true, local body must stick.
    rerender(
      <WikiPageEditor
        wikiId="wiki-1"
        path="index.md"
        serverPage={{ ...basePage, content: "NEW SERVER" }}
        wiki={baseWiki}
      />,
    );

    // DocumentEditor is re-rendered, but we assert via `initialContent`
    // prop on the last render — the dirty path keeps `body` === "dirty body".
    const lastCall =
      documentEditorProps.mock.calls[documentEditorProps.mock.calls.length - 1];
    expect(lastCall[0]).toMatchObject({ initialContent: "dirty body" });
  });

  it("resets local state from serverPage when not dirty", () => {
    const { rerender } = render(
      <WikiPageEditor
        wikiId="wiki-1"
        path="index.md"
        serverPage={basePage}
        wiki={baseWiki}
      />,
    );
    // Clean re-seed: advance to a new server page; useWikiDraft is not
    // dirty, so the effect should reset.
    rerender(
      <WikiPageEditor
        wikiId="wiki-1"
        path="index.md"
        serverPage={{ ...basePage, content: "fresh body" }}
        wiki={baseWiki}
      />,
    );
    const lastCall =
      documentEditorProps.mock.calls[documentEditorProps.mock.calls.length - 1];
    expect(lastCall[0]).toMatchObject({ initialContent: "fresh body" });
  });

  it("hydrates local state from a draft that arrives asynchronously", () => {
    // First render: no draft yet.
    draftHook.state = makeDraftState();
    const { rerender } = render(
      <WikiPageEditor
        wikiId="wiki-1"
        path="index.md"
        serverPage={basePage}
        wiki={baseWiki}
      />,
    );
    let lastCall =
      documentEditorProps.mock.calls[documentEditorProps.mock.calls.length - 1];
    expect(lastCall[0]).toMatchObject({ initialContent: "server body" });

    // Second render: the hook surfaces a draft (e.g. stale-alert path).
    draftHook.state = makeDraftState({
      draft: { body: "async draft", frontmatter: { icon: "🦊" } },
      isDirty: true,
      hasStaleAlert: true,
    });
    rerender(
      <WikiPageEditor
        wikiId="wiki-1"
        path="index.md"
        serverPage={basePage}
        wiki={baseWiki}
      />,
    );
    lastCall =
      documentEditorProps.mock.calls[documentEditorProps.mock.calls.length - 1];
    expect(lastCall[0]).toMatchObject({ initialContent: "async draft" });
    expect(screen.getByTestId("mock-icon-picker")).toHaveAttribute(
      "data-value",
      "🦊",
    );
  });

  it("no-ops setDraft calls from the (read-only) DocumentEditor onChange", () => {
    const setDraft = vi.fn();
    draftHook.state = makeDraftState({ setDraft });
    render(
      <WikiPageEditor
        wikiId="wiki-1"
        path="index.md"
        serverPage={basePage}
        wiki={{ ...baseWiki, humanPermission: "read" }}
      />,
    );
    // Even if a (mis)behaving child forces onChange through, the
    // read-only guard inside handleBodyChange should drop it.
    const lastCall =
      documentEditorProps.mock.calls[documentEditorProps.mock.calls.length - 1];
    const onChange = lastCall[0].onChange as (md: string) => void;
    onChange("forced write");
    expect(setDraft).not.toHaveBeenCalled();
  });

  it("passes the wikiId through to the cover picker", () => {
    render(
      <WikiPageEditor
        wikiId="wiki-42"
        path="index.md"
        serverPage={basePage}
        wiki={baseWiki}
      />,
    );
    expect(screen.getByTestId("mock-cover-picker")).toHaveAttribute(
      "data-wiki-id",
      "wiki-42",
    );
  });

  it("tolerates a server page without a lastCommit", () => {
    render(
      <WikiPageEditor
        wikiId="wiki-1"
        path="index.md"
        serverPage={{ ...basePage, lastCommit: null }}
        wiki={baseWiki}
      />,
    );
    // The editor still mounts with server content. The `?? null` branch on
    // lastCommit.timestamp is exercised here.
    expect(
      (screen.getByTestId("doc-editor") as HTMLTextAreaElement).defaultValue,
    ).toBe("server body");
  });

  it("remounts DocumentEditor when serverPage commit sha changes and not dirty", () => {
    const { rerender } = render(
      <WikiPageEditor
        wikiId="wiki-1"
        path="index.md"
        serverPage={basePage}
        wiki={baseWiki}
      />,
    );
    expect(documentEditorMounts.count).toBe(1);
    expect(documentEditorUnmounts.count).toBe(0);

    // Another user commits → new sha + new content. isDirty is false, so
    // the clean-reset path runs and bumps seedGen → the editor unmounts
    // and a fresh one mounts with the new initialContent. This exercises
    // the Critical-fix path: DocumentEditor's InitialContentPlugin would
    // otherwise ingest initialContent only once and silently keep the
    // stale Lexical state.
    const newPage: PageDto = {
      ...basePage,
      content: "REMOTE EDIT",
      lastCommit: {
        sha: "xyz",
        author: "someone-else",
        timestamp: "2026-04-16T00:00:00.000Z",
      },
    };
    rerender(
      <WikiPageEditor
        wikiId="wiki-1"
        path="index.md"
        serverPage={newPage}
        wiki={baseWiki}
      />,
    );

    expect(documentEditorUnmounts.count).toBe(1);
    expect(documentEditorMounts.count).toBe(2);
    const lastCall =
      documentEditorProps.mock.calls[documentEditorProps.mock.calls.length - 1];
    expect(lastCall[0]).toMatchObject({ initialContent: "REMOTE EDIT" });
  });

  it("does NOT remount DocumentEditor on user typing (cursor/focus preserved)", async () => {
    const setDraft = vi.fn();
    draftHook.state = makeDraftState({ setDraft, isDirty: false });
    const { rerender } = render(
      <WikiPageEditor
        wikiId="wiki-1"
        path="index.md"
        serverPage={basePage}
        wiki={baseWiki}
      />,
    );
    expect(documentEditorMounts.count).toBe(1);

    const editor = screen.getByTestId("doc-editor") as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(editor, { target: { value: "t" } });
    });
    await act(async () => {
      fireEvent.change(editor, { target: { value: "ty" } });
    });

    // Simulate what useWikiDraft does: each setDraft call produces a new
    // draft object identity. isDirty flips true. The editor must stay
    // mounted across these deliveries so the cursor/focus is preserved.
    draftHook.state = makeDraftState({
      setDraft,
      isDirty: true,
      draft: { body: "ty", frontmatter: basePage.frontmatter },
    });
    rerender(
      <WikiPageEditor
        wikiId="wiki-1"
        path="index.md"
        serverPage={basePage}
        wiki={baseWiki}
      />,
    );
    draftHook.state = makeDraftState({
      setDraft,
      isDirty: true,
      // Same content but a fresh object identity, as if setDraft fired
      // again on another keystroke.
      draft: { body: "typ", frontmatter: basePage.frontmatter },
    });
    rerender(
      <WikiPageEditor
        wikiId="wiki-1"
        path="index.md"
        serverPage={basePage}
        wiki={baseWiki}
      />,
    );

    // After the first async-draft arrival seedGen bumps once → one
    // unmount + one remount; subsequent draft identity changes must NOT
    // cause further remounts (the ref gate holds).
    expect(documentEditorMounts.count).toBeLessThanOrEqual(2);
    expect(documentEditorUnmounts.count).toBeLessThanOrEqual(1);
  });

  it("remounts DocumentEditor on first async draft arrival (seeds exactly once)", () => {
    draftHook.state = makeDraftState();
    const { rerender } = render(
      <WikiPageEditor
        wikiId="wiki-1"
        path="index.md"
        serverPage={basePage}
        wiki={baseWiki}
      />,
    );
    expect(documentEditorMounts.count).toBe(1);

    // Draft arrives asynchronously (the stale-alert path).
    draftHook.state = makeDraftState({
      draft: { body: "async draft", frontmatter: { icon: "🦊" } },
      isDirty: true,
      hasStaleAlert: true,
    });
    rerender(
      <WikiPageEditor
        wikiId="wiki-1"
        path="index.md"
        serverPage={basePage}
        wiki={baseWiki}
      />,
    );
    expect(documentEditorMounts.count).toBe(2);
    expect(documentEditorUnmounts.count).toBe(1);
    const lastCall =
      documentEditorProps.mock.calls[documentEditorProps.mock.calls.length - 1];
    expect(lastCall[0]).toMatchObject({ initialContent: "async draft" });

    // A subsequent re-delivery of the SAME draft value but a fresh
    // object identity (as would happen on every setDraft during typing)
    // must not cause another remount.
    draftHook.state = makeDraftState({
      draft: { body: "async draft", frontmatter: { icon: "🦊" } },
      isDirty: true,
      hasStaleAlert: true,
    });
    rerender(
      <WikiPageEditor
        wikiId="wiki-1"
        path="index.md"
        serverPage={basePage}
        wiki={baseWiki}
      />,
    );
    expect(documentEditorMounts.count).toBe(2);
    expect(documentEditorUnmounts.count).toBe(1);
  });

  it("re-seeds again if a draft is cleared and a new draft later arrives", () => {
    draftHook.state = makeDraftState({
      draft: { body: "first draft", frontmatter: basePage.frontmatter },
    });
    const { rerender } = render(
      <WikiPageEditor
        wikiId="wiki-1"
        path="index.md"
        serverPage={basePage}
        wiki={baseWiki}
      />,
    );
    const mountsAfterInitial = documentEditorMounts.count;

    // Draft cleared (e.g. clearDraft after a commit). The ref should
    // reset so a later draft re-arrival is treated as "first".
    draftHook.state = makeDraftState({ draft: null });
    rerender(
      <WikiPageEditor
        wikiId="wiki-1"
        path="index.md"
        serverPage={basePage}
        wiki={baseWiki}
      />,
    );

    // New draft shows up again (user typed after save).
    draftHook.state = makeDraftState({
      draft: { body: "post-save draft", frontmatter: basePage.frontmatter },
      isDirty: true,
    });
    rerender(
      <WikiPageEditor
        wikiId="wiki-1"
        path="index.md"
        serverPage={basePage}
        wiki={baseWiki}
      />,
    );

    expect(documentEditorMounts.count).toBeGreaterThan(mountsAfterInitial);
    const lastCall =
      documentEditorProps.mock.calls[documentEditorProps.mock.calls.length - 1];
    expect(lastCall[0]).toMatchObject({ initialContent: "post-save draft" });
  });

  it("drops frontmatter edits driven from a mis-behaving child when readOnly", () => {
    const setDraft = vi.fn();
    draftHook.state = makeDraftState({ setDraft });
    render(
      <WikiPageEditor
        wikiId="wiki-1"
        path="index.md"
        serverPage={basePage}
        wiki={{ ...baseWiki, humanPermission: "read" }}
      />,
    );
    // Grab the onChange the host passed to the child and invoke it even
    // though the (real) disabled attribute would normally suppress a click.
    const lastIconCall =
      iconPickerProps.mock.calls[iconPickerProps.mock.calls.length - 1];
    const onChange = lastIconCall[0].onChange as (icon: string) => void;
    onChange("🎨");
    expect(setDraft).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------
  // Save flow (Task 19)
  // ---------------------------------------------------------------------
  describe("save flow", () => {
    let alertSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      // The real implementation calls window.alert for success/failure.
      // Replace it with a clean spy each test so call history doesn't leak
      // across tests. `vi.spyOn` is idempotent on an already-spied method
      // but we call `mockClear` for safety.
      alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
      alertSpy.mockClear();
    });

    it("disables the Save button when not dirty, enables when dirty", () => {
      draftHook.state = makeDraftState({ isDirty: false });
      const { rerender } = render(
        <WikiPageEditor
          wikiId="wiki-1"
          path="index.md"
          serverPage={basePage}
          wiki={baseWiki}
        />,
      );
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

      draftHook.state = makeDraftState({ isDirty: true });
      rerender(
        <WikiPageEditor
          wikiId="wiki-1"
          path="index.md"
          serverPage={basePage}
          wiki={baseWiki}
        />,
      );
      expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    });

    it("disables the Save button when the user is read-only", () => {
      draftHook.state = makeDraftState({ isDirty: true });
      render(
        <WikiPageEditor
          wikiId="wiki-1"
          path="index.md"
          serverPage={basePage}
          wiki={{ ...baseWiki, humanPermission: "read" }}
        />,
      );
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    });

    it("disables the Save button while a commit is pending", () => {
      draftHook.state = makeDraftState({ isDirty: true });
      commitHook.isPending = true;
      render(
        <WikiPageEditor
          wikiId="wiki-1"
          path="index.md"
          serverPage={basePage}
          wiki={baseWiki}
        />,
      );
      expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    });

    it("auto mode: commits with propose:false, clears the draft, and toasts", async () => {
      const clearDraft = vi.fn();
      draftHook.state = makeDraftState({
        isDirty: true,
        clearDraft,
        draft: {
          body: "draft body",
          frontmatter: { icon: "🚀", title: "Home" },
        },
      });
      commitHook.mutateAsync.mockResolvedValue({
        commit: { sha: "new-sha" },
        proposal: null,
      });
      render(
        <WikiPageEditor
          wikiId="wiki-1"
          path="index.md"
          serverPage={basePage}
          wiki={baseWiki}
        />,
      );
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
      });
      expect(commitHook.mutateAsync).toHaveBeenCalledTimes(1);
      const dto = commitHook.mutateAsync.mock.calls[0][0] as {
        message: string;
        files: Array<{ path: string; content: string; action: string }>;
        propose: boolean;
      };
      expect(dto.propose).toBe(false);
      expect(dto.files).toHaveLength(1);
      expect(dto.files[0]).toMatchObject({
        path: "index.md",
        action: "update",
      });
      // Serialized markdown: frontmatter fence → yaml → body.
      expect(dto.files[0].content).toContain("---");
      expect(dto.files[0].content).toContain("icon:");
      expect(dto.files[0].content).toContain("\uD83D\uDE80");
      expect(dto.files[0].content).toContain("draft body");
      expect(clearDraft).toHaveBeenCalledTimes(1);
      expect(setSubmittedProposalSpy).not.toHaveBeenCalled();
    });

    it("review mode: opens the dialog instead of committing immediately", async () => {
      draftHook.state = makeDraftState({
        isDirty: true,
        draft: {
          body: "draft body",
          frontmatter: basePage.frontmatter,
        },
      });
      render(
        <WikiPageEditor
          wikiId="wiki-1"
          path="index.md"
          serverPage={basePage}
          wiki={{ ...baseWiki, approvalMode: "review" }}
        />,
      );
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
      });
      expect(commitHook.mutateAsync).not.toHaveBeenCalled();
      expect(screen.getByTestId("mock-review-dialog")).toBeInTheDocument();
    });

    it("review mode: dialog submit → commits with propose:true, records proposal, keeps draft", async () => {
      const clearDraft = vi.fn();
      draftHook.state = makeDraftState({
        isDirty: true,
        clearDraft,
        draft: {
          body: "draft body",
          frontmatter: basePage.frontmatter,
        },
      });
      commitHook.mutateAsync.mockResolvedValue({
        commit: { sha: "new-sha" },
        proposal: { id: "prop-42" },
      });
      render(
        <WikiPageEditor
          wikiId="wiki-1"
          path="index.md"
          serverPage={basePage}
          wiki={{ ...baseWiki, approvalMode: "review" }}
        />,
      );
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
      });
      await act(async () => {
        fireEvent.click(screen.getByTestId("mock-review-submit"));
      });
      expect(commitHook.mutateAsync).toHaveBeenCalledTimes(1);
      const dto = commitHook.mutateAsync.mock.calls[0][0] as {
        message: string;
        propose: boolean;
      };
      expect(dto.propose).toBe(true);
      expect(dto.message).toBe("Fix typo");
      expect(setSubmittedProposalSpy).toHaveBeenCalledWith(
        "wiki-1",
        "index.md",
        "prop-42",
      );
      // Draft must NOT be cleared on the review-mode success path.
      expect(clearDraft).not.toHaveBeenCalled();
    });

    it("review mode: falls back to a default message when the dialog title is empty", async () => {
      draftHook.state = makeDraftState({
        isDirty: true,
        draft: { body: "draft body", frontmatter: basePage.frontmatter },
      });
      commitHook.mutateAsync.mockResolvedValue({
        commit: { sha: "new-sha" },
        proposal: { id: "prop-42" },
      });
      render(
        <WikiPageEditor
          wikiId="wiki-1"
          path="index.md"
          serverPage={basePage}
          wiki={{ ...baseWiki, approvalMode: "review" }}
        />,
      );
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
      });
      // Read the props the dialog was handed; invoke onSubmit directly with
      // a whitespace-only title to exercise the fallback commit message.
      const lastCall =
        submitForReviewProps.mock.calls[
          submitForReviewProps.mock.calls.length - 1
        ];
      const onSubmit = lastCall[0].onSubmit as (input: {
        title: string;
        description?: string;
      }) => void;
      await act(async () => {
        onSubmit({ title: "   " });
      });
      const dto = commitHook.mutateAsync.mock.calls[0][0] as {
        message: string;
      };
      expect(dto.message).toBe("Update index.md");
    });

    it("Cmd+S triggers save when dirty (auto mode)", async () => {
      draftHook.state = makeDraftState({
        isDirty: true,
        draft: { body: "draft body", frontmatter: basePage.frontmatter },
      });
      render(
        <WikiPageEditor
          wikiId="wiki-1"
          path="index.md"
          serverPage={basePage}
          wiki={baseWiki}
        />,
      );
      await act(async () => {
        fireEvent.keyDown(window, { key: "s", metaKey: true });
      });
      expect(commitHook.mutateAsync).toHaveBeenCalledTimes(1);
    });

    it("Ctrl+S (uppercase S) also triggers save", async () => {
      draftHook.state = makeDraftState({
        isDirty: true,
        draft: { body: "draft body", frontmatter: basePage.frontmatter },
      });
      render(
        <WikiPageEditor
          wikiId="wiki-1"
          path="index.md"
          serverPage={basePage}
          wiki={baseWiki}
        />,
      );
      await act(async () => {
        fireEvent.keyDown(window, { key: "S", ctrlKey: true });
      });
      expect(commitHook.mutateAsync).toHaveBeenCalledTimes(1);
    });

    it("Cmd+S is a no-op when not dirty", async () => {
      draftHook.state = makeDraftState({ isDirty: false });
      render(
        <WikiPageEditor
          wikiId="wiki-1"
          path="index.md"
          serverPage={basePage}
          wiki={baseWiki}
        />,
      );
      await act(async () => {
        fireEvent.keyDown(window, { key: "s", metaKey: true });
      });
      expect(commitHook.mutateAsync).not.toHaveBeenCalled();
    });

    it("Cmd+S is a no-op while a commit is already pending", async () => {
      draftHook.state = makeDraftState({ isDirty: true });
      commitHook.isPending = true;
      render(
        <WikiPageEditor
          wikiId="wiki-1"
          path="index.md"
          serverPage={basePage}
          wiki={baseWiki}
        />,
      );
      await act(async () => {
        fireEvent.keyDown(window, { key: "s", metaKey: true });
      });
      expect(commitHook.mutateAsync).not.toHaveBeenCalled();
    });

    it("Cmd+S does nothing when the user is read-only", async () => {
      draftHook.state = makeDraftState({ isDirty: true });
      render(
        <WikiPageEditor
          wikiId="wiki-1"
          path="index.md"
          serverPage={basePage}
          wiki={{ ...baseWiki, humanPermission: "read" }}
        />,
      );
      await act(async () => {
        fireEvent.keyDown(window, { key: "s", metaKey: true });
      });
      expect(commitHook.mutateAsync).not.toHaveBeenCalled();
    });

    it("non-save key presses do not trigger save", async () => {
      draftHook.state = makeDraftState({ isDirty: true });
      render(
        <WikiPageEditor
          wikiId="wiki-1"
          path="index.md"
          serverPage={basePage}
          wiki={baseWiki}
        />,
      );
      await act(async () => {
        fireEvent.keyDown(window, { key: "a", metaKey: true });
      });
      await act(async () => {
        fireEvent.keyDown(window, { key: "s" });
      });
      expect(commitHook.mutateAsync).not.toHaveBeenCalled();
    });

    it("removes the keydown listener on unmount", async () => {
      draftHook.state = makeDraftState({ isDirty: true });
      const { unmount } = render(
        <WikiPageEditor
          wikiId="wiki-1"
          path="index.md"
          serverPage={basePage}
          wiki={baseWiki}
        />,
      );
      unmount();
      await act(async () => {
        fireEvent.keyDown(window, { key: "s", metaKey: true });
      });
      expect(commitHook.mutateAsync).not.toHaveBeenCalled();
    });

    it("409 error surfaces a conflict-specific alert", async () => {
      draftHook.state = makeDraftState({ isDirty: true });
      const err = Object.assign(new Error("conflict"), { status: 409 });
      commitHook.mutateAsync.mockReset();
      commitHook.mutateAsync.mockRejectedValue(err);
      render(
        <WikiPageEditor
          wikiId="wiki-1"
          path="index.md"
          serverPage={basePage}
          wiki={baseWiki}
        />,
      );
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
      });
      expect(alertSpy).toHaveBeenCalledTimes(1);
      expect(alertSpy.mock.calls[0][0]).toMatch(/changed on the server/i);
    });

    it("403 error surfaces a permission-specific alert", async () => {
      draftHook.state = makeDraftState({ isDirty: true });
      const err = Object.assign(new Error("forbidden"), { status: 403 });
      commitHook.mutateAsync.mockReset();
      commitHook.mutateAsync.mockRejectedValue(err);
      render(
        <WikiPageEditor
          wikiId="wiki-1"
          path="index.md"
          serverPage={basePage}
          wiki={baseWiki}
        />,
      );
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
      });
      expect(alertSpy.mock.calls[0][0]).toMatch(/don't have permission/i);
    });

    it("generic error surfaces a generic alert", async () => {
      draftHook.state = makeDraftState({ isDirty: true });
      const err = Object.assign(new Error("boom"), { status: 500 });
      commitHook.mutateAsync.mockReset();
      commitHook.mutateAsync.mockRejectedValue(err);
      render(
        <WikiPageEditor
          wikiId="wiki-1"
          path="index.md"
          serverPage={basePage}
          wiki={baseWiki}
        />,
      );
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
      });
      expect(alertSpy.mock.calls[0][0]).toBe("Save failed. Please try again.");
    });

    it("error without a status still produces the generic alert", async () => {
      draftHook.state = makeDraftState({ isDirty: true });
      commitHook.mutateAsync.mockReset();
      commitHook.mutateAsync.mockRejectedValue(new Error("network"));
      render(
        <WikiPageEditor
          wikiId="wiki-1"
          path="index.md"
          serverPage={basePage}
          wiki={baseWiki}
        />,
      );
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
      });
      expect(alertSpy.mock.calls[0][0]).toBe("Save failed. Please try again.");
    });

    it("status bar last-saved reflects serverPage.lastCommit.timestamp", () => {
      render(
        <WikiPageEditor
          wikiId="wiki-1"
          path="index.md"
          serverPage={basePage}
          wiki={baseWiki}
        />,
      );
      expect(screen.getByTestId("wiki-status-last-saved")).toBeInTheDocument();
    });

    it("passes null lastSavedAt when serverPage has no lastCommit", () => {
      render(
        <WikiPageEditor
          wikiId="wiki-1"
          path="index.md"
          serverPage={{ ...basePage, lastCommit: null }}
          wiki={baseWiki}
        />,
      );
      // No lastSavedAt chip should render.
      expect(screen.queryByTestId("wiki-status-last-saved")).toBeNull();
    });
  });

  // ---------------------------------------------------------------------
  // Image paste / drop upload (Task 22)
  // ---------------------------------------------------------------------
  describe("image paste / drop upload", () => {
    let alertSpy: ReturnType<typeof vi.spyOn>;

    /** Build a minimal `File` that passes an MIME-type check. */
    function makeFile(name: string, type = "image/png", size = 16): File {
      return new File([new Uint8Array(size)], name, { type });
    }

    /**
     * Construct a `DataTransferItemList`-like payload that
     * `React.ClipboardEvent` is happy to forward. React's synthetic clipboard
     * event preserves the native `clipboardData`, so we hand it a mock object
     * rather than try to construct a real `ClipboardEvent` (jsdom doesn't
     * expose the constructor in a stable way).
     */
    function clipboardWithItems(
      items: Array<{ kind: string; type: string; file: File | null }>,
    ) {
      return {
        items: items.map((it) => ({
          kind: it.kind,
          type: it.type,
          getAsFile: () => it.file,
        })),
      };
    }

    function dataTransferWithFiles(files: File[]) {
      return { files, items: [] };
    }

    beforeEach(() => {
      alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
      alertSpy.mockClear();
      // Default: upload hook succeeds with a deterministic path.
      imageUploadHook.upload.mockReset();
      imageUploadHook.upload.mockResolvedValue("attachments/abc.png");
    });

    it("paste of an image triggers upload and appends markdown to the body", async () => {
      const setDraft = vi.fn();
      draftHook.state = makeDraftState({ setDraft });
      render(
        <WikiPageEditor
          wikiId="wiki-1"
          path="index.md"
          serverPage={basePage}
          wiki={baseWiki}
        />,
      );

      const zone = screen.getByTestId("wiki-page-editor-drop-zone");
      const file = makeFile("photo.png");
      await act(async () => {
        fireEvent.paste(zone, {
          clipboardData: clipboardWithItems([
            { kind: "file", type: "image/png", file },
          ]),
        });
      });

      await vi.waitFor(() => {
        expect(imageUploadHook.upload).toHaveBeenCalledWith(
          file,
          "attachments",
        );
      });
      // body update: append `![photo.png](attachments/abc.png)`
      await vi.waitFor(() => {
        expect(setDraft).toHaveBeenCalled();
      });
      const lastCall = setDraft.mock.calls[setDraft.mock.calls.length - 1];
      expect(lastCall[0].body).toContain("![photo.png](attachments/abc.png)");
      // server body existed, so new markdown must be appended after it.
      expect(lastCall[0].body.startsWith("server body")).toBe(true);
    });

    it("paste into an empty body writes the markdown directly (no leading newlines)", async () => {
      const setDraft = vi.fn();
      draftHook.state = makeDraftState({ setDraft });
      render(
        <WikiPageEditor
          wikiId="wiki-1"
          path="index.md"
          serverPage={{ ...basePage, content: "" }}
          wiki={baseWiki}
        />,
      );
      const zone = screen.getByTestId("wiki-page-editor-drop-zone");
      await act(async () => {
        fireEvent.paste(zone, {
          clipboardData: clipboardWithItems([
            { kind: "file", type: "image/png", file: makeFile("a.png") },
          ]),
        });
      });
      await vi.waitFor(() => {
        expect(setDraft).toHaveBeenCalled();
      });
      const lastCall = setDraft.mock.calls[setDraft.mock.calls.length - 1];
      expect(lastCall[0].body.startsWith("![a.png]")).toBe(true);
    });

    it("paste of a non-image is ignored (no upload, no body change)", async () => {
      const setDraft = vi.fn();
      draftHook.state = makeDraftState({ setDraft });
      render(
        <WikiPageEditor
          wikiId="wiki-1"
          path="index.md"
          serverPage={basePage}
          wiki={baseWiki}
        />,
      );
      const zone = screen.getByTestId("wiki-page-editor-drop-zone");
      fireEvent.paste(zone, {
        clipboardData: clipboardWithItems([
          { kind: "string", type: "text/plain", file: null },
        ]),
      });
      // Non-image items take the synchronous early-exit branch; no async
      // upload is scheduled, so no flush is needed.
      expect(imageUploadHook.upload).not.toHaveBeenCalled();
      expect(setDraft).not.toHaveBeenCalled();
    });

    it("paste of a mixed clipboard (text + image) picks up only the image", async () => {
      const setDraft = vi.fn();
      draftHook.state = makeDraftState({ setDraft });
      render(
        <WikiPageEditor
          wikiId="wiki-1"
          path="index.md"
          serverPage={basePage}
          wiki={baseWiki}
        />,
      );
      const zone = screen.getByTestId("wiki-page-editor-drop-zone");
      const file = makeFile("mixed.png");
      await act(async () => {
        fireEvent.paste(zone, {
          clipboardData: clipboardWithItems([
            { kind: "string", type: "text/plain", file: null },
            { kind: "file", type: "image/png", file },
          ]),
        });
      });
      await vi.waitFor(() => {
        expect(imageUploadHook.upload).toHaveBeenCalledTimes(1);
      });
      expect(imageUploadHook.upload).toHaveBeenCalledWith(file, "attachments");
    });

    it("paste when getAsFile returns null does not call upload", async () => {
      const setDraft = vi.fn();
      draftHook.state = makeDraftState({ setDraft });
      render(
        <WikiPageEditor
          wikiId="wiki-1"
          path="index.md"
          serverPage={basePage}
          wiki={baseWiki}
        />,
      );
      const zone = screen.getByTestId("wiki-page-editor-drop-zone");
      fireEvent.paste(zone, {
        clipboardData: clipboardWithItems([
          { kind: "file", type: "image/png", file: null },
        ]),
      });
      // `getAsFile() === null` is guarded inline; no async upload is started.
      expect(imageUploadHook.upload).not.toHaveBeenCalled();
    });

    it("paste with no clipboardData items is a no-op", async () => {
      draftHook.state = makeDraftState();
      render(
        <WikiPageEditor
          wikiId="wiki-1"
          path="index.md"
          serverPage={basePage}
          wiki={baseWiki}
        />,
      );
      const zone = screen.getByTestId("wiki-page-editor-drop-zone");
      await act(async () => {
        fireEvent.paste(zone, { clipboardData: { items: [] } });
      });
      expect(imageUploadHook.upload).not.toHaveBeenCalled();
    });

    it("paste is ignored when read-only", async () => {
      const setDraft = vi.fn();
      draftHook.state = makeDraftState({ setDraft });
      render(
        <WikiPageEditor
          wikiId="wiki-1"
          path="index.md"
          serverPage={basePage}
          wiki={{ ...baseWiki, humanPermission: "read" }}
        />,
      );
      const zone = screen.getByTestId("wiki-page-editor-drop-zone");
      fireEvent.paste(zone, {
        clipboardData: clipboardWithItems([
          { kind: "file", type: "image/png", file: makeFile("x.png") },
        ]),
      });
      // Read-only takes the synchronous early-exit branch in handlePaste.
      expect(imageUploadHook.upload).not.toHaveBeenCalled();
      expect(setDraft).not.toHaveBeenCalled();
    });

    it("oversize paste shows the 'File too large' alert via rejected upload", async () => {
      imageUploadHook.upload.mockRejectedValue(
        new Error("File too large (max 5 MB)"),
      );
      draftHook.state = makeDraftState();
      render(
        <WikiPageEditor
          wikiId="wiki-1"
          path="index.md"
          serverPage={basePage}
          wiki={baseWiki}
        />,
      );
      const zone = screen.getByTestId("wiki-page-editor-drop-zone");
      await act(async () => {
        fireEvent.paste(zone, {
          clipboardData: clipboardWithItems([
            { kind: "file", type: "image/png", file: makeFile("big.png") },
          ]),
        });
      });
      await vi.waitFor(() => {
        expect(alertSpy).toHaveBeenCalledWith("File too large (max 5 MB)");
      });
    });

    it("generic upload failure fires a generic 'Upload failed' toast when the error is not an Error instance", async () => {
      imageUploadHook.upload.mockRejectedValue("boom");
      render(
        <WikiPageEditor
          wikiId="wiki-1"
          path="index.md"
          serverPage={basePage}
          wiki={baseWiki}
        />,
      );
      const zone = screen.getByTestId("wiki-page-editor-drop-zone");
      await act(async () => {
        fireEvent.paste(zone, {
          clipboardData: clipboardWithItems([
            { kind: "file", type: "image/png", file: makeFile("x.png") },
          ]),
        });
      });
      await vi.waitFor(() => {
        expect(alertSpy).toHaveBeenCalledWith("Upload failed");
      });
    });

    it("drop of an image triggers upload and appends markdown", async () => {
      const setDraft = vi.fn();
      draftHook.state = makeDraftState({ setDraft });
      render(
        <WikiPageEditor
          wikiId="wiki-1"
          path="index.md"
          serverPage={basePage}
          wiki={baseWiki}
        />,
      );
      const zone = screen.getByTestId("wiki-page-editor-drop-zone");
      const file = makeFile("dropped.png");
      await act(async () => {
        fireEvent.drop(zone, {
          dataTransfer: dataTransferWithFiles([file]),
        });
      });
      await vi.waitFor(() => {
        expect(imageUploadHook.upload).toHaveBeenCalledWith(
          file,
          "attachments",
        );
      });
      await vi.waitFor(() => {
        expect(setDraft).toHaveBeenCalled();
      });
      const lastCall = setDraft.mock.calls[setDraft.mock.calls.length - 1];
      expect(lastCall[0].body).toContain("![dropped.png](attachments/abc.png)");
    });

    it("drop of multiple images uploads each; non-images in the same drop are skipped", async () => {
      imageUploadHook.upload.mockImplementation(
        async (f: File) => `attachments/${f.name}-uuid.bin`,
      );
      render(
        <WikiPageEditor
          wikiId="wiki-1"
          path="index.md"
          serverPage={basePage}
          wiki={baseWiki}
        />,
      );
      const zone = screen.getByTestId("wiki-page-editor-drop-zone");
      const a = makeFile("a.png", "image/png");
      const b = makeFile("b.jpg", "image/jpeg");
      const text = makeFile("notes.txt", "text/plain");
      await act(async () => {
        fireEvent.drop(zone, {
          dataTransfer: dataTransferWithFiles([a, text, b]),
        });
      });
      await vi.waitFor(() => {
        expect(imageUploadHook.upload).toHaveBeenCalledTimes(2);
      });
      const calls = imageUploadHook.upload.mock.calls.map((c) => c[0].name);
      expect(calls).toEqual(["a.png", "b.jpg"]);
    });

    it("drop with no files is a no-op", async () => {
      render(
        <WikiPageEditor
          wikiId="wiki-1"
          path="index.md"
          serverPage={basePage}
          wiki={baseWiki}
        />,
      );
      const zone = screen.getByTestId("wiki-page-editor-drop-zone");
      await act(async () => {
        fireEvent.drop(zone, {
          dataTransfer: dataTransferWithFiles([]),
        });
      });
      expect(imageUploadHook.upload).not.toHaveBeenCalled();
    });

    it("drop of only non-image files does not upload", async () => {
      render(
        <WikiPageEditor
          wikiId="wiki-1"
          path="index.md"
          serverPage={basePage}
          wiki={baseWiki}
        />,
      );
      const zone = screen.getByTestId("wiki-page-editor-drop-zone");
      fireEvent.drop(zone, {
        dataTransfer: dataTransferWithFiles([
          makeFile("notes.txt", "text/plain"),
        ]),
      });
      // Non-image files take the synchronous early-exit branch in handleDrop.
      expect(imageUploadHook.upload).not.toHaveBeenCalled();
    });

    it("drop is ignored when read-only", async () => {
      render(
        <WikiPageEditor
          wikiId="wiki-1"
          path="index.md"
          serverPage={basePage}
          wiki={{ ...baseWiki, humanPermission: "read" }}
        />,
      );
      const zone = screen.getByTestId("wiki-page-editor-drop-zone");
      fireEvent.drop(zone, {
        dataTransfer: dataTransferWithFiles([makeFile("x.png")]),
      });
      // Read-only takes the synchronous early-exit branch in handleDrop.
      expect(imageUploadHook.upload).not.toHaveBeenCalled();
    });

    it("dragover preventDefault is called so the zone is a valid drop target", () => {
      render(
        <WikiPageEditor
          wikiId="wiki-1"
          path="index.md"
          serverPage={basePage}
          wiki={baseWiki}
        />,
      );
      const zone = screen.getByTestId("wiki-page-editor-drop-zone");
      // The synthetic event's .defaultPrevented tracks our preventDefault()
      const event = new Event("dragover", { bubbles: true, cancelable: true });
      const prevented = !zone.dispatchEvent(event);
      // React re-dispatches via synthetic events; our handler calls
      // preventDefault() which sets defaultPrevented. The raw dispatchEvent
      // returns `false` when default is prevented.
      expect(prevented || event.defaultPrevented).toBe(true);
    });

    it("dragover is a no-op when read-only (no preventDefault)", () => {
      render(
        <WikiPageEditor
          wikiId="wiki-1"
          path="index.md"
          serverPage={basePage}
          wiki={{ ...baseWiki, humanPermission: "read" }}
        />,
      );
      const zone = screen.getByTestId("wiki-page-editor-drop-zone");
      const event = new Event("dragover", { bubbles: true, cancelable: true });
      zone.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    });

    it("sequential pastes accumulate markdown in the body", async () => {
      const setDraft = vi.fn();
      draftHook.state = makeDraftState({ setDraft });
      imageUploadHook.upload
        .mockResolvedValueOnce("attachments/first.png")
        .mockResolvedValueOnce("attachments/second.png");
      render(
        <WikiPageEditor
          wikiId="wiki-1"
          path="index.md"
          serverPage={basePage}
          wiki={baseWiki}
        />,
      );
      const zone = screen.getByTestId("wiki-page-editor-drop-zone");

      await act(async () => {
        fireEvent.paste(zone, {
          clipboardData: clipboardWithItems([
            { kind: "file", type: "image/png", file: makeFile("one.png") },
          ]),
        });
      });
      // Wait for the first paste's body update to settle *and* for React to
      // commit the render so `latestBodyRef` has been refreshed. We check
      // for the updated `initialContent` prop on the (mocked) DocumentEditor
      // — that only updates via `setBody`, which feeds `latestBodyRef`
      // through the component's sync effect.
      await vi.waitFor(() => {
        const last =
          documentEditorProps.mock.calls[
            documentEditorProps.mock.calls.length - 1
          ];
        expect(last?.[0]?.initialContent).toContain(
          "![one.png](attachments/first.png)",
        );
      });

      await act(async () => {
        fireEvent.paste(zone, {
          clipboardData: clipboardWithItems([
            { kind: "file", type: "image/png", file: makeFile("two.png") },
          ]),
        });
      });
      await vi.waitFor(() => {
        expect(imageUploadHook.upload).toHaveBeenCalledTimes(2);
      });
      await vi.waitFor(() => {
        const last = setDraft.mock.calls[setDraft.mock.calls.length - 1];
        expect(last?.[0]?.body).toContain("![two.png](attachments/second.png)");
      });

      const lastCall = setDraft.mock.calls[setDraft.mock.calls.length - 1];
      // Both markdown links should be present in the accumulated body.
      expect(lastCall[0].body).toContain("![one.png](attachments/first.png)");
      expect(lastCall[0].body).toContain("![two.png](attachments/second.png)");
    });
  });
});

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

// --- SUT -----------------------------------------------------------------

import { WikiPageEditor } from "../WikiPageEditor";

const baseWiki: WikiDto = {
  id: "wiki-1",
  workspaceId: "ws-1",
  name: "Handbook",
  slug: "handbook",
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
});

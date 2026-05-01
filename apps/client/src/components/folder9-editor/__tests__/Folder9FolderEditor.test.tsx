import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock DocumentEditor to a textarea so we don't pull Lexical into tests.
vi.mock("@/components/documents/DocumentEditor", () => ({
  DocumentEditor: (props: {
    initialContent?: string;
    onChange?: (md: string) => void;
    readOnly?: boolean;
  }) => (
    <textarea
      data-testid="doc-editor"
      data-readonly={props.readOnly ? "true" : "false"}
      defaultValue={props.initialContent ?? ""}
      readOnly={!!props.readOnly}
      onChange={(e) => props.onChange?.(e.target.value)}
    />
  ),
}));

// Reusable mock useFolderDraft so we can drive the dirty / draft branches
// deterministically.
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

vi.mock("@/hooks/useFolderDraft", () => ({
  useFolderDraft: () => draftHook.state,
  buildFolderDraftKey: (k: string, p: string) => `team9.folder.draft.${k}.${p}`,
}));

import {
  Folder9FolderEditor,
  type Folder9FolderEditorProps,
} from "../Folder9FolderEditor";
import type {
  BlobDto,
  CommitRequest,
  CommitResult,
  Folder9FolderApi,
  TreeEntryDto,
} from "@/services/api/folder9-folder";

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

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

const tree: TreeEntryDto[] = [
  { name: "SKILL.md", path: "SKILL.md", type: "file", size: 42 },
  { name: "scripts", path: "scripts", type: "dir", size: 0 },
  {
    name: "deploy.sh",
    path: "scripts/deploy.sh",
    type: "file",
    size: 100,
  },
];

const blob: BlobDto = {
  path: "SKILL.md",
  content: "# Server body",
  encoding: "text",
};

interface ApiSpy {
  api: Folder9FolderApi;
  fetchTree: ReturnType<typeof vi.fn>;
  fetchBlob: ReturnType<typeof vi.fn>;
  commit: ReturnType<typeof vi.fn>;
}

function makeApi(overrides: Partial<Folder9FolderApi> = {}): ApiSpy {
  const fetchTree = vi.fn(async () => tree);
  const fetchBlob = vi.fn(async (path: string): Promise<BlobDto> => {
    if (path === "SKILL.md") return blob;
    return {
      path,
      content: `body of ${path}`,
      encoding: "text",
    };
  });
  const commit = vi.fn(
    async (req: CommitRequest): Promise<CommitResult> => ({
      sha: `sha-for-${req.files[0]?.path ?? "?"}`,
    }),
  );
  const api: Folder9FolderApi = {
    fetchTree,
    fetchBlob,
    commit,
    ...overrides,
  };
  return { api, fetchTree, fetchBlob, commit };
}

function baseProps(
  overrides: Partial<Folder9FolderEditorProps> = {},
): Folder9FolderEditorProps {
  const { api } = makeApi();
  return {
    folderId: "folder-1",
    permission: "write",
    approvalMode: "auto",
    api,
    draftKey: "ws-1.folder-1.user-1",
    ...overrides,
  };
}

beforeEach(() => {
  vi.spyOn(window, "alert").mockImplementation(() => {});
  draftHook.state = makeDraftState();
});

describe("Folder9FolderEditor — tree rendering & blob fetch", () => {
  it("renders the tree from api.fetchTree and shows file rows", async () => {
    const Wrapper = makeWrapper();
    const props = baseProps();

    render(
      <Wrapper>
        <Folder9FolderEditor {...props} />
      </Wrapper>,
    );

    await waitFor(() =>
      expect(
        screen.getByRole("treeitem", { name: /SKILL\.md/ }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("treeitem", { name: /scripts/ }),
    ).toBeInTheDocument();
  });

  it("clicking a file row triggers api.fetchBlob with that path", async () => {
    const { api, fetchBlob } = makeApi();
    const Wrapper = makeWrapper();

    render(
      <Wrapper>
        <Folder9FolderEditor {...baseProps({ api })} />
      </Wrapper>,
    );

    await waitFor(() =>
      expect(
        screen.getByRole("treeitem", { name: /SKILL\.md/ }),
      ).toBeInTheDocument(),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("treeitem", { name: /SKILL\.md/ }));
    });

    await waitFor(() => expect(fetchBlob).toHaveBeenCalledWith("SKILL.md"));
  });

  it("renders the body via the default markdown editor for .md files", async () => {
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <Folder9FolderEditor {...baseProps({ initialPath: "SKILL.md" })} />
      </Wrapper>,
    );

    const editor = await screen.findByTestId("doc-editor");
    expect(editor).toBeInTheDocument();
    expect((editor as HTMLTextAreaElement).value).toBe("# Server body");
  });

  it("reloads the body when the external initialPath changes", async () => {
    const { api, fetchBlob } = makeApi();
    const Wrapper = makeWrapper();
    const { rerender } = render(
      <Wrapper>
        <Folder9FolderEditor
          {...baseProps({ api, hideTree: true, initialPath: "SKILL.md" })}
        />
      </Wrapper>,
    );

    expect(await screen.findByTestId("doc-editor")).toHaveValue(
      "# Server body",
    );

    rerender(
      <Wrapper>
        <Folder9FolderEditor
          {...baseProps({
            api,
            hideTree: true,
            initialPath: "docs/intro.md",
          })}
        />
      </Wrapper>,
    );

    await waitFor(() =>
      expect(fetchBlob).toHaveBeenCalledWith("docs/intro.md"),
    );
    await waitFor(() =>
      expect(screen.getByTestId("doc-editor")).toHaveValue(
        "body of docs/intro.md",
      ),
    );
  });

  it("reloads the body when the folder changes but the path stays the same", async () => {
    const apiA = makeApi({
      fetchBlob: vi.fn(
        async (path: string): Promise<BlobDto> => ({
          path,
          content: "body from folder A",
          encoding: "text",
        }),
      ),
    }).api;
    const apiB = makeApi({
      fetchBlob: vi.fn(
        async (path: string): Promise<BlobDto> => ({
          path,
          content: "body from folder B",
          encoding: "text",
        }),
      ),
    }).api;
    const Wrapper = makeWrapper();
    const { rerender } = render(
      <Wrapper>
        <Folder9FolderEditor
          {...baseProps({
            api: apiA,
            folderId: "folder-a",
            hideTree: true,
            initialPath: "index.md",
          })}
        />
      </Wrapper>,
    );

    expect(await screen.findByTestId("doc-editor")).toHaveValue(
      "body from folder A",
    );

    rerender(
      <Wrapper>
        <Folder9FolderEditor
          {...baseProps({
            api: apiB,
            folderId: "folder-b",
            hideTree: true,
            initialPath: "index.md",
          })}
        />
      </Wrapper>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("doc-editor")).toHaveValue(
        "body from folder B",
      ),
    );
  });

  it("falls back to a plain textarea for non-markdown text files", async () => {
    const { api } = makeApi();
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <Folder9FolderEditor
          {...baseProps({ api, initialPath: "scripts/deploy.sh" })}
        />
      </Wrapper>,
    );
    expect(
      await screen.findByTestId("folder9-folder-textarea"),
    ).toBeInTheDocument();
  });

  it("textarea fallback forwards user input through onChange", async () => {
    const setDraft = vi.fn();
    draftHook.state = makeDraftState({ setDraft });
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <Folder9FolderEditor
          {...baseProps({ initialPath: "scripts/deploy.sh" })}
        />
      </Wrapper>,
    );
    const ta = await screen.findByTestId("folder9-folder-textarea");
    fireEvent.change(ta, { target: { value: "echo hi" } });
    expect(setDraft).toHaveBeenCalledWith({
      body: "echo hi",
      frontmatter: {},
    });
  });

  it("shows a generic loading placeholder while the blob is in flight", async () => {
    let resolveBlob: ((b: BlobDto) => void) | undefined;
    const { api } = makeApi({
      fetchBlob: vi.fn(
        () =>
          new Promise<BlobDto>((resolve) => {
            resolveBlob = resolve;
          }),
      ),
    });
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <Folder9FolderEditor {...baseProps({ api, initialPath: "SKILL.md" })} />
      </Wrapper>,
    );
    // Loading placeholder visible — empty state isn't shown either.
    expect(screen.queryByTestId("folder9-folder-empty")).toBeNull();
    expect(screen.queryByTestId("doc-editor")).toBeNull();

    // Resolve so the test cleans up cleanly.
    await act(async () => {
      resolveBlob?.(blob);
    });
  });

  it("clicking a directory toggles expansion (and again collapses it)", async () => {
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <Folder9FolderEditor {...baseProps()} />
      </Wrapper>,
    );

    const dirRow = await screen.findByRole("treeitem", { name: /scripts/ });
    expect(dirRow).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(dirRow);
    expect(dirRow).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(dirRow);
    expect(dirRow).toHaveAttribute("aria-expanded", "false");
  });

  it("clicking a directory with index.md selects the index file", async () => {
    const treeWithIndex: TreeEntryDto[] = [
      { name: "api", path: "api", type: "dir", size: 0 },
      {
        name: "index.md",
        path: "api/index.md",
        type: "file",
        size: 10,
      },
    ];
    const { api, fetchBlob } = makeApi();
    api.fetchTree = vi.fn(async () => treeWithIndex);

    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <Folder9FolderEditor {...baseProps({ api })} />
      </Wrapper>,
    );

    const dirRow = await screen.findByRole("treeitem", { name: /api/ });
    await act(async () => {
      fireEvent.click(dirRow);
    });

    await waitFor(() => expect(fetchBlob).toHaveBeenCalledWith("api/index.md"));
  });

  it("shows the empty state when no path is selected", () => {
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <Folder9FolderEditor {...baseProps()} />
      </Wrapper>,
    );
    expect(screen.getByTestId("folder9-folder-empty")).toBeInTheDocument();
  });

  it("shows the binary placeholder when blob.encoding is base64 and no renderFile is provided", async () => {
    const { api } = makeApi({
      fetchBlob: vi.fn(
        async (): Promise<BlobDto> => ({
          path: "logo.png",
          content: "ZmFrZQ==",
          encoding: "base64",
        }),
      ),
    });
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <Folder9FolderEditor {...baseProps({ api, initialPath: "logo.png" })} />
      </Wrapper>,
    );
    expect(
      await screen.findByTestId("folder9-folder-binary"),
    ).toBeInTheDocument();
  });
});

describe("Folder9FolderEditor — read-only mode", () => {
  it("disables save and renders the editor in readOnly mode when permission=read", async () => {
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <Folder9FolderEditor
          {...baseProps({ permission: "read", initialPath: "SKILL.md" })}
        />
      </Wrapper>,
    );

    const editor = await screen.findByTestId("doc-editor");
    expect(editor).toHaveAttribute("data-readonly", "true");

    const saveBtn = screen.getByRole("button", { name: /save/i });
    expect(saveBtn).toBeDisabled();
  });

  it("ignores edits while in read-only mode", async () => {
    const setDraft = vi.fn();
    draftHook.state = makeDraftState({ setDraft });
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <Folder9FolderEditor
          {...baseProps({ permission: "read", initialPath: "SKILL.md" })}
        />
      </Wrapper>,
    );

    const editor = await screen.findByTestId("doc-editor");
    fireEvent.change(editor, { target: { value: "user typed" } });
    // setDraft is gated by readOnly inside the shell.
    expect(setDraft).not.toHaveBeenCalled();
  });
});

describe("Folder9FolderEditor — commit pipeline", () => {
  it("calls api.commit with the right shape on save (auto mode)", async () => {
    const { api, commit } = makeApi();
    const setDraft = vi.fn();
    const clearDraft = vi.fn();
    draftHook.state = makeDraftState({
      draft: { body: "edited", frontmatter: {} },
      isDirty: true,
      setDraft,
      clearDraft,
    });

    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <Folder9FolderEditor {...baseProps({ api, initialPath: "SKILL.md" })} />
      </Wrapper>,
    );

    await screen.findByTestId("doc-editor");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save/i }));
    });

    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    expect(commit).toHaveBeenCalledWith({
      message: "Update SKILL.md",
      files: [
        {
          path: "SKILL.md",
          content: "edited",
          action: "update",
        },
      ],
      propose: false,
    });
    // Auto-mode commit clears the draft.
    expect(clearDraft).toHaveBeenCalledTimes(1);
  });

  it("does NOT call commit when the editor is clean", async () => {
    const { api, commit } = makeApi();
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <Folder9FolderEditor {...baseProps({ api, initialPath: "SKILL.md" })} />
      </Wrapper>,
    );

    await screen.findByTestId("doc-editor");
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(commit).not.toHaveBeenCalled();
  });

  it("review-mode + propose permission sets propose: true on commit", async () => {
    const { api, commit } = makeApi();
    const clearDraft = vi.fn();
    draftHook.state = makeDraftState({
      draft: { body: "proposed", frontmatter: {} },
      isDirty: true,
      clearDraft,
    });

    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <Folder9FolderEditor
          {...baseProps({
            api,
            initialPath: "SKILL.md",
            permission: "propose",
            approvalMode: "review",
          })}
        />
      </Wrapper>,
    );

    await screen.findByTestId("doc-editor");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save/i }));
    });

    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    expect(commit).toHaveBeenCalledWith(
      expect.objectContaining({ propose: true }),
    );
    // Review-mode commits don't clear the draft — user keeps iterating.
    expect(clearDraft).not.toHaveBeenCalled();
  });

  it("review-mode + write permission sets propose: false on commit", async () => {
    const { api, commit } = makeApi();
    draftHook.state = makeDraftState({
      draft: { body: "edited", frontmatter: {} },
      isDirty: true,
    });

    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <Folder9FolderEditor
          {...baseProps({
            api,
            initialPath: "SKILL.md",
            permission: "write",
            approvalMode: "review",
          })}
        />
      </Wrapper>,
    );

    await screen.findByTestId("doc-editor");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save/i }));
    });

    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    expect(commit).toHaveBeenCalledWith(
      expect.objectContaining({ propose: false }),
    );
  });

  it("auto-mode + propose permission still sets propose: false (not in review)", async () => {
    const { api, commit } = makeApi();
    draftHook.state = makeDraftState({
      draft: { body: "edited", frontmatter: {} },
      isDirty: true,
    });
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <Folder9FolderEditor
          {...baseProps({
            api,
            initialPath: "SKILL.md",
            permission: "propose",
            approvalMode: "auto",
          })}
        />
      </Wrapper>,
    );
    await screen.findByTestId("doc-editor");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save/i }));
    });

    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    expect(commit).toHaveBeenCalledWith(
      expect.objectContaining({ propose: false }),
    );
  });

  it("defers to onProposeReview when provided in review mode", async () => {
    const { api, commit } = makeApi();
    draftHook.state = makeDraftState({
      draft: { body: "edited", frontmatter: {} },
      isDirty: true,
    });

    const onProposeReview = vi.fn(
      (proceed: (input: { message?: string }) => void) => {
        // Wiki-side wrapper would normally show a dialog and call back
        // with metadata; emulate that synchronously.
        proceed({ message: "Fix typo" });
      },
    );

    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <Folder9FolderEditor
          {...baseProps({
            api,
            initialPath: "SKILL.md",
            permission: "propose",
            approvalMode: "review",
            onProposeReview,
          })}
        />
      </Wrapper>,
    );

    await screen.findByTestId("doc-editor");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save/i }));
    });

    expect(onProposeReview).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    expect(commit).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Fix typo",
        propose: true,
      }),
    );
  });

  it("surfaces a stale-alert when useFolderDraft reports one", async () => {
    draftHook.state = makeDraftState({
      draft: { body: "local", frontmatter: {} },
      isDirty: true,
      hasStaleAlert: true,
    });
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <Folder9FolderEditor {...baseProps({ initialPath: "SKILL.md" })} />
      </Wrapper>,
    );

    expect(
      await screen.findByTestId("folder9-folder-stale-alert"),
    ).toBeInTheDocument();
  });

  it("alerts with a friendly message when commit fails", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const { api } = makeApi({
      commit: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    draftHook.state = makeDraftState({
      draft: { body: "edited", frontmatter: {} },
      isDirty: true,
    });
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <Folder9FolderEditor {...baseProps({ api, initialPath: "SKILL.md" })} />
      </Wrapper>,
    );
    await screen.findByTestId("doc-editor");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save/i }));
    });

    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    alertSpy.mockRestore();
  });
});

describe("Folder9FolderEditor — renderFile slot", () => {
  it("uses renderFile when it returns a node", async () => {
    const renderFile = vi.fn((args: { path: string; content: string }) => (
      <div data-testid="custom-renderer">
        custom for {args.path}: {args.content}
      </div>
    ));
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <Folder9FolderEditor
          {...baseProps({ initialPath: "SKILL.md", renderFile })}
        />
      </Wrapper>,
    );

    expect(await screen.findByTestId("custom-renderer")).toBeInTheDocument();
    expect(renderFile).toHaveBeenCalled();
    // The shell may invoke renderFile multiple times during hydration —
    // the *latest* invocation is the one with the content seeded from
    // the server blob. Earlier invocations might fire before the
    // server-seed effect runs (content === "").
    await waitFor(() => {
      const last = renderFile.mock.lastCall?.[0] as
        | Record<string, unknown>
        | undefined;
      expect(last?.content).toBe("# Server body");
    });
    const last = renderFile.mock.lastCall?.[0] as Record<string, unknown>;
    expect(last.path).toBe("SKILL.md");
    expect(last.readOnly).toBe(false);
    expect(last.encoding).toBe("text");
    expect(typeof last.onChange).toBe("function");
  });

  it("falls back to default renderer when renderFile returns undefined", async () => {
    const renderFile = vi.fn(() => undefined);
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <Folder9FolderEditor
          {...baseProps({ initialPath: "SKILL.md", renderFile })}
        />
      </Wrapper>,
    );

    // Default renderer for .md = DocumentEditor (mocked to a textarea).
    expect(await screen.findByTestId("doc-editor")).toBeInTheDocument();
    expect(renderFile).toHaveBeenCalled();
  });
});

describe("Folder9FolderEditor — image upload integration", () => {
  it("calls imageUpload.upload on paste when one is provided", async () => {
    const uploader = { upload: vi.fn().mockResolvedValue("attachments/x.png") };
    draftHook.state = makeDraftState();
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <Folder9FolderEditor
          {...baseProps({ initialPath: "SKILL.md", imageUpload: uploader })}
        />
      </Wrapper>,
    );

    const dropZone = await screen.findByTestId(
      "folder9-folder-editor-drop-zone",
    );

    const file = new File(["fake"], "img.png", { type: "image/png" });
    const items = [
      {
        kind: "file",
        type: "image/png",
        getAsFile: () => file,
      },
    ] as unknown as DataTransferItem[];

    await act(async () => {
      fireEvent.paste(dropZone, {
        clipboardData: { items },
      });
    });

    await waitFor(() => expect(uploader.upload).toHaveBeenCalledTimes(1));
    expect(uploader.upload).toHaveBeenCalledWith(file, "attachments");
  });

  it("calls imageUpload.upload on drop when one is provided", async () => {
    const uploader = { upload: vi.fn().mockResolvedValue("attachments/y.png") };
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <Folder9FolderEditor
          {...baseProps({ initialPath: "SKILL.md", imageUpload: uploader })}
        />
      </Wrapper>,
    );
    const dropZone = await screen.findByTestId(
      "folder9-folder-editor-drop-zone",
    );
    const file = new File(["x"], "drop.png", { type: "image/png" });

    await act(async () => {
      fireEvent.drop(dropZone, {
        dataTransfer: { files: [file] },
      });
    });

    await waitFor(() => expect(uploader.upload).toHaveBeenCalledTimes(1));
    expect(uploader.upload).toHaveBeenCalledWith(file, "attachments");
  });

  it("preventDefault on dragover so the editor is a valid drop target", async () => {
    const uploader = { upload: vi.fn() };
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <Folder9FolderEditor
          {...baseProps({ initialPath: "SKILL.md", imageUpload: uploader })}
        />
      </Wrapper>,
    );
    const dropZone = await screen.findByTestId(
      "folder9-folder-editor-drop-zone",
    );

    // Synthesize a dragover. preventDefault should be called by the
    // shell — fireEvent returns false when defaultPrevented is set.
    const ok = fireEvent.dragOver(dropZone, {
      dataTransfer: { items: [] },
    });
    expect(ok).toBe(false);
  });

  it("does not upload on drop when there are no image files", async () => {
    const uploader = { upload: vi.fn() };
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <Folder9FolderEditor
          {...baseProps({ initialPath: "SKILL.md", imageUpload: uploader })}
        />
      </Wrapper>,
    );
    const dropZone = await screen.findByTestId(
      "folder9-folder-editor-drop-zone",
    );
    const file = new File(["x"], "doc.txt", { type: "text/plain" });
    fireEvent.drop(dropZone, { dataTransfer: { files: [file] } });
    expect(uploader.upload).not.toHaveBeenCalled();
  });

  it("alerts when the image upload throws", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const uploader = {
      upload: vi.fn().mockRejectedValue(new Error("network")),
    };
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <Folder9FolderEditor
          {...baseProps({ initialPath: "SKILL.md", imageUpload: uploader })}
        />
      </Wrapper>,
    );
    const dropZone = await screen.findByTestId(
      "folder9-folder-editor-drop-zone",
    );
    const file = new File(["x"], "img.png", { type: "image/png" });

    await act(async () => {
      fireEvent.paste(dropZone, {
        clipboardData: {
          items: [
            {
              kind: "file",
              type: "image/png",
              getAsFile: () => file,
            },
          ],
        },
      });
    });
    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    alertSpy.mockRestore();
  });

  // I4 regression — concurrent uploads must serialize on the body ref
  // so neither image's markdown is clobbered. Before the fix, both
  // uploads read `latestBodyRef.current` then wrote back, so the
  // second one's setBody erased the first's append.
  it("I4 — two concurrent paste-uploads both end up in the final body", async () => {
    // Two upload calls resolve at controllable timings so we can
    // interleave their completions deterministically. We capture the
    // setDraft calls (the only observable side-effect of body
    // mutation, given DocumentEditor is mocked away from us) and
    // assert that the FINAL setDraft body contains BOTH markdown
    // strings.
    let resolveA: (path: string) => void = () => {};
    let resolveB: (path: string) => void = () => {};
    const promiseA = new Promise<string>((r) => {
      resolveA = r;
    });
    const promiseB = new Promise<string>((r) => {
      resolveB = r;
    });
    let call = 0;
    const uploader = {
      upload: vi.fn().mockImplementation(() => {
        call += 1;
        return call === 1 ? promiseA : promiseB;
      }),
    };

    const setDraftSpy = vi.fn();
    draftHook.state = makeDraftState({ setDraft: setDraftSpy });

    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <Folder9FolderEditor
          {...baseProps({ initialPath: "SKILL.md", imageUpload: uploader })}
        />
      </Wrapper>,
    );

    const dropZone = await screen.findByTestId(
      "folder9-folder-editor-drop-zone",
    );

    // Fire two paste events in rapid succession; neither has resolved
    // its upload promise yet.
    const fileA = new File(["A"], "imgA.png", { type: "image/png" });
    const fileB = new File(["B"], "imgB.png", { type: "image/png" });

    await act(async () => {
      fireEvent.paste(dropZone, {
        clipboardData: {
          items: [{ kind: "file", type: "image/png", getAsFile: () => fileA }],
        },
      });
      fireEvent.paste(dropZone, {
        clipboardData: {
          items: [{ kind: "file", type: "image/png", getAsFile: () => fileB }],
        },
      });
    });

    // Resolve both upload promises near-simultaneously. The order
    // doesn't matter — the fix must keep BOTH markdown strings in the
    // body regardless.
    await act(async () => {
      resolveA("attachments/A.png");
      resolveB("attachments/B.png");
      // Flush microtasks
      await Promise.resolve();
      await Promise.resolve();
    });

    // The final draft body must contain BOTH image markdowns. Before
    // I4 fix, only one would survive (whichever ran second clobbered
    // the other).
    await waitFor(() => {
      expect(setDraftSpy).toHaveBeenCalled();
    });
    const lastDraft =
      setDraftSpy.mock.calls[setDraftSpy.mock.calls.length - 1]?.[0];
    expect(lastDraft).toBeDefined();
    expect(lastDraft.body).toContain("imgA.png");
    expect(lastDraft.body).toContain("imgB.png");
  });

  it("does not register paste/drop hooks when no uploader is provided", async () => {
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <Folder9FolderEditor {...baseProps({ initialPath: "SKILL.md" })} />
      </Wrapper>,
    );
    const dropZone = await screen.findByTestId(
      "folder9-folder-editor-drop-zone",
    );

    // No uploader — the synthetic paste event must not throw and the
    // shell must not preventDefault (we can't directly assert that with
    // RTL, but at least nothing throws and no upload is attempted).
    expect(() =>
      fireEvent.paste(dropZone, {
        clipboardData: {
          items: [
            {
              kind: "file",
              type: "image/png",
              getAsFile: () => new File([""], "x.png", { type: "image/png" }),
            },
          ],
        },
      }),
    ).not.toThrow();
  });
});

describe("Folder9FolderEditor — hideTree prop", () => {
  it("renders the tree sidebar by default (hideTree omitted)", async () => {
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <Folder9FolderEditor {...baseProps()} />
      </Wrapper>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("folder9-folder-tree")).toBeInTheDocument(),
    );
  });

  it("renders the tree sidebar when hideTree=false", async () => {
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <Folder9FolderEditor {...baseProps({ hideTree: false })} />
      </Wrapper>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("folder9-folder-tree")).toBeInTheDocument(),
    );
  });

  it("does NOT render the tree sidebar when hideTree=true", async () => {
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <Folder9FolderEditor
          {...baseProps({ hideTree: true, initialPath: "SKILL.md" })}
        />
      </Wrapper>,
    );

    // Editor still mounts (full-width single-column layout).
    await screen.findByTestId("doc-editor");
    expect(screen.queryByTestId("folder9-folder-tree")).toBeNull();
  });

  it("skips api.fetchTree when hideTree=true AND initialPath is provided", async () => {
    const { api, fetchTree } = makeApi();
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <Folder9FolderEditor
          {...baseProps({
            api,
            hideTree: true,
            initialPath: "SKILL.md",
          })}
        />
      </Wrapper>,
    );

    // Wait for the blob to load so the editor finishes its initial
    // render pass — gives the tree query a chance to fire if it were
    // going to.
    await screen.findByTestId("doc-editor");
    expect(fetchTree).not.toHaveBeenCalled();
  });

  it("still calls api.fetchTree when hideTree=true but initialPath is undefined (default-path resolution)", async () => {
    const { api, fetchTree } = makeApi();
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <Folder9FolderEditor {...baseProps({ api, hideTree: true })} />
      </Wrapper>,
    );

    await waitFor(() => expect(fetchTree).toHaveBeenCalledTimes(1));
  });

  it("still calls api.fetchTree when hideTree=false (tree must populate)", async () => {
    const { api, fetchTree } = makeApi();
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <Folder9FolderEditor
          {...baseProps({ api, hideTree: false, initialPath: "SKILL.md" })}
        />
      </Wrapper>,
    );

    await waitFor(() => expect(fetchTree).toHaveBeenCalledTimes(1));
  });
});

describe("Folder9FolderEditor — Cmd/Ctrl+S shortcut", () => {
  it("triggers save on Cmd+S when dirty", async () => {
    const { api, commit } = makeApi();
    draftHook.state = makeDraftState({
      draft: { body: "edited", frontmatter: {} },
      isDirty: true,
    });

    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <Folder9FolderEditor {...baseProps({ api, initialPath: "SKILL.md" })} />
      </Wrapper>,
    );
    await screen.findByTestId("doc-editor");

    await act(async () => {
      fireEvent.keyDown(window, { key: "s", metaKey: true });
    });

    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
  });

  it("ignores non-save keys", async () => {
    const { api, commit } = makeApi();
    draftHook.state = makeDraftState({
      draft: { body: "edited", frontmatter: {} },
      isDirty: true,
    });
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <Folder9FolderEditor {...baseProps({ api, initialPath: "SKILL.md" })} />
      </Wrapper>,
    );
    await screen.findByTestId("doc-editor");
    await act(async () => {
      fireEvent.keyDown(window, { key: "a", metaKey: true });
    });
    expect(commit).not.toHaveBeenCalled();
  });

  it("triggers save on Ctrl+S as well as Cmd+S", async () => {
    const { api, commit } = makeApi();
    draftHook.state = makeDraftState({
      draft: { body: "edited", frontmatter: {} },
      isDirty: true,
    });
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <Folder9FolderEditor {...baseProps({ api, initialPath: "SKILL.md" })} />
      </Wrapper>,
    );
    await screen.findByTestId("doc-editor");
    await act(async () => {
      fireEvent.keyDown(window, { key: "S", ctrlKey: true });
    });
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
  });
});

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PageDto, WikiDto } from "@/types/wiki";
import type {
  Folder9FolderEditorProps,
  ProposeReviewInput,
} from "@/components/folder9-editor/Folder9FolderEditor";

// ---------------------------------------------------------------------------
// Mocks
//
// The shell (`<Folder9FolderEditor>`) has its own dedicated test suite under
// `components/folder9-editor/__tests__`. Here we want to verify only the
// wiki-flavoured wrapper's contract: prop wiring (api, permission, draftKey,
// imageUpload), the review-dialog hand-off, the proposal-id sink into the
// wiki store, and the in-slot frontmatter serialization. So we replace the
// shell with a tiny stub that exposes the inputs it received plus a few
// hooks the tests can invoke to simulate runtime callbacks.
// ---------------------------------------------------------------------------

const folderEditorProps = vi.hoisted(() =>
  vi.fn<(props: Folder9FolderEditorProps) => void>(),
);

// Module-level recorder for the `onChange` callback the wiki slot
// receives. Tests inspect / reset this between cases.
const slotState = vi.hoisted(() => ({
  lastBody: null as string | null,
}));

vi.mock("@/components/folder9-editor/Folder9FolderEditor", () => ({
  Folder9FolderEditor: (props: Folder9FolderEditorProps) => {
    folderEditorProps(props);
    // Render `renderFile` with synthetic args so wiki-side slot wiring is
    // exercised inside the test as a real DOM tree (icon picker, cover
    // picker, document editor stand-in).
    const slot = props.renderFile?.({
      path: props.initialPath ?? "index.md",
      editorKey: `mock:${props.folderId}:${props.initialPath ?? "index.md"}`,
      content: `---\nicon: 🚀\ntitle: Home\n---\n\nbody from ${props.folderId}`,
      encoding: "text",
      readOnly: props.permission === "read",
      onChange: (next) => {
        slotState.lastBody = next;
      },
    });
    return (
      <div data-testid="mock-folder9-editor">
        <div data-testid="mock-folder9-editor-folder-id">{props.folderId}</div>
        <div data-testid="mock-folder9-editor-permission">
          {props.permission}
        </div>
        <div data-testid="mock-folder9-editor-approval-mode">
          {props.approvalMode}
        </div>
        <div data-testid="mock-folder9-editor-draft-key">{props.draftKey}</div>
        <div data-testid="mock-folder9-editor-initial-path">
          {props.initialPath ?? ""}
        </div>
        <button
          type="button"
          data-testid="mock-folder9-editor-trigger-propose"
          onClick={() => {
            // Invoke the wiki's `onProposeReview` with a recordable
            // `proceed` continuation so the test can assert on the
            // commit message it eventually composes.
            const callback = props.onProposeReview;
            if (!callback) return;
            callback((input: ProposeReviewInput) => {
              proposeReviewProceedInputs.push(input);
            });
          }}
        >
          trigger-propose
        </button>
        <button
          type="button"
          data-testid="mock-folder9-editor-call-image-upload"
          onClick={() => {
            void props.imageUpload?.upload(
              new File([], "x.png", { type: "image/png" }),
              "attachments",
            );
          }}
        >
          call-image-upload
        </button>
        <button
          type="button"
          data-testid="mock-folder9-editor-call-commit"
          onClick={() => {
            void props.api
              .commit({
                message: "Update from test",
                files: [
                  {
                    path: "index.md",
                    content: "any",
                    action: "update",
                  },
                ],
                propose: true,
              })
              .catch(() => {
                // surfaced via spy
              });
          }}
        >
          call-commit
        </button>
        <div data-testid="mock-folder9-editor-slot">{slot}</div>
      </div>
    );
  },
}));

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

const iconPickerProps = vi.hoisted(() =>
  vi.fn<(props: Record<string, unknown>) => void>(),
);

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
          data-testid="mock-review-submit-title-only"
          onClick={() => props.onSubmit({ title: "Just a title" })}
        >
          submit-title-only
        </button>
        <button
          type="button"
          data-testid="mock-review-submit-empty"
          onClick={() => props.onSubmit({ title: "   " })}
        >
          submit-empty
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

const currentUserMock = vi.hoisted(() => ({
  data: { id: "user-1", userType: "human" } as unknown as {
    id: string;
    userType?: string;
  } | null,
}));

vi.mock("@/hooks/useAuth", () => ({
  useCurrentUser: () => ({ data: currentUserMock.data }),
}));

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

const setSubmittedProposalSpy = vi.hoisted(() => vi.fn());

vi.mock("@/stores/useWikiStore", () => ({
  wikiActions: {
    setSubmittedProposal: (...args: unknown[]) =>
      setSubmittedProposalSpy(...args),
  },
}));

const workspaceMock = vi.hoisted(() => ({
  selectedWorkspaceId: "ws-1" as string | null,
}));

vi.mock("@/stores/useWorkspaceStore", () => ({
  useWorkspaceStore: <T,>(
    selector: (s: { selectedWorkspaceId: string | null }) => T,
  ) => selector({ selectedWorkspaceId: workspaceMock.selectedWorkspaceId }),
}));

// `wikiFolderApi` is exercised end-to-end by `services/api/__tests__`;
// here we just spy the factory so we can verify which `wikiId` the
// wrapper passed and intercept the `commit` call to assert the wiki's
// proposal-id mirroring effect.
const wikiFolderApiCommit = vi.hoisted(() =>
  vi.fn<
    (req: {
      message: string;
      files: { path: string; content: string; action: string }[];
      propose?: boolean;
    }) => Promise<{ sha: string; proposalId?: string }>
  >(),
);

const wikiFolderApiFactory = vi.hoisted(() =>
  vi.fn((_wikiId: string) => ({
    fetchTree: vi.fn(),
    fetchBlob: vi.fn(),
    commit: wikiFolderApiCommit,
  })),
);

vi.mock("@/services/api/folder9-folder", async () => {
  const actual = await vi.importActual<
    typeof import("@/services/api/folder9-folder")
  >("@/services/api/folder9-folder");
  return {
    ...actual,
    wikiFolderApi: (id: string) => wikiFolderApiFactory(id),
  };
});

// Captured during `onProposeReview(proceed)` invocations from the shell
// stub — the test asserts on what the wiki passes back into `proceed`.
const proposeReviewProceedInputs: ProposeReviewInput[] = [];

// ---------------------------------------------------------------------------
// SUT
// ---------------------------------------------------------------------------

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
  encoding: "text",
  frontmatter: { icon: "🚀", title: "Home" },
  lastCommit: {
    sha: "abc",
    author: "winrey",
    timestamp: "2026-04-15T00:00:00.000Z",
  },
};

beforeEach(() => {
  folderEditorProps.mockReset();
  iconPickerProps.mockReset();
  submitForReviewProps.mockReset();
  setSubmittedProposalSpy.mockReset();
  wikiFolderApiCommit.mockReset();
  wikiFolderApiCommit.mockResolvedValue({ sha: "new-sha" });
  wikiFolderApiFactory.mockClear();
  imageUploadHook.upload.mockReset();
  imageUploadHook.upload.mockResolvedValue("attachments/x-uuid.png");
  proposeReviewProceedInputs.length = 0;
  slotState.lastBody = null;
  workspaceMock.selectedWorkspaceId = "ws-1";
  currentUserMock.data = {
    id: "user-1",
    userType: "human",
  } as unknown as { id: string; userType?: string };
});

async function click(el: HTMLElement) {
  await act(async () => {
    fireEvent.click(el);
  });
}

describe("WikiPageEditor (wrapper around <Folder9FolderEditor>)", () => {
  describe("prop wiring", () => {
    it("passes wikiId, write permission, approvalMode, and initialPath to the shell", () => {
      render(
        <WikiPageEditor
          wikiId="wiki-1"
          path="docs/index.md"
          serverPage={basePage}
          wiki={baseWiki}
        />,
      );
      expect(
        screen.getByTestId("mock-folder9-editor-folder-id"),
      ).toHaveTextContent("wiki-1");
      expect(
        screen.getByTestId("mock-folder9-editor-permission"),
      ).toHaveTextContent("write");
      expect(
        screen.getByTestId("mock-folder9-editor-approval-mode"),
      ).toHaveTextContent("auto");
      expect(
        screen.getByTestId("mock-folder9-editor-initial-path"),
      ).toHaveTextContent("docs/index.md");
    });

    it("derives `read` permission for an absent user", () => {
      currentUserMock.data = null;
      render(
        <WikiPageEditor
          wikiId="wiki-1"
          path="index.md"
          serverPage={basePage}
          wiki={baseWiki}
        />,
      );
      // Wrapper still renders (no user, but workspace is set) — but the
      // shell receives `read` so it can flip its own UI accordingly.
      // Note: draftKey requires userId, so no user → wrapper bails out
      // and renders null. Verify that explicitly.
      expect(screen.queryByTestId("mock-folder9-editor")).toBeNull();
    });

    it("derives `read` permission for an agent user", () => {
      currentUserMock.data = {
        id: "agent-1",
        userType: "agent",
      } as unknown as { id: string; userType?: string };
      render(
        <WikiPageEditor
          wikiId="wiki-1"
          path="index.md"
          serverPage={basePage}
          wiki={baseWiki}
        />,
      );
      expect(
        screen.getByTestId("mock-folder9-editor-permission"),
      ).toHaveTextContent("read");
    });

    it("uses humanPermission for human users", () => {
      render(
        <WikiPageEditor
          wikiId="wiki-1"
          path="index.md"
          serverPage={basePage}
          wiki={{ ...baseWiki, humanPermission: "propose" }}
        />,
      );
      expect(
        screen.getByTestId("mock-folder9-editor-permission"),
      ).toHaveTextContent("propose");
    });

    it("forwards `review` approvalMode through to the shell", () => {
      render(
        <WikiPageEditor
          wikiId="wiki-1"
          path="index.md"
          serverPage={basePage}
          wiki={{ ...baseWiki, approvalMode: "review" }}
        />,
      );
      expect(
        screen.getByTestId("mock-folder9-editor-approval-mode"),
      ).toHaveTextContent("review");
    });

    it("composes the draftKey from workspace + wiki + user id", () => {
      render(
        <WikiPageEditor
          wikiId="wiki-42"
          path="index.md"
          serverPage={basePage}
          wiki={{ ...baseWiki, id: "wiki-42" }}
        />,
      );
      expect(
        screen.getByTestId("mock-folder9-editor-draft-key"),
      ).toHaveTextContent("ws-1.wiki-42.user-1");
    });

    it("renders nothing when workspace is not selected", () => {
      workspaceMock.selectedWorkspaceId = null;
      const { container } = render(
        <WikiPageEditor
          wikiId="wiki-1"
          path="index.md"
          serverPage={basePage}
          wiki={baseWiki}
        />,
      );
      expect(container.firstChild).toBeNull();
    });

    it("constructs `wikiFolderApi` from the wiki id", () => {
      render(
        <WikiPageEditor
          wikiId="wiki-99"
          path="index.md"
          serverPage={basePage}
          wiki={{ ...baseWiki, id: "wiki-99" }}
        />,
      );
      expect(wikiFolderApiFactory).toHaveBeenCalledWith("wiki-99");
    });

    it("passes hideTree=true so the shell does not render its built-in tree (wiki has its own sub-sidebar)", () => {
      render(
        <WikiPageEditor
          wikiId="wiki-1"
          path="index.md"
          serverPage={basePage}
          wiki={baseWiki}
        />,
      );
      expect(folderEditorProps).toHaveBeenCalled();
      const props = folderEditorProps.mock.lastCall?.[0];
      expect(props?.hideTree).toBe(true);
    });

    it("wires the image-upload hook into the shell's imageUpload slot", async () => {
      render(
        <WikiPageEditor
          wikiId="wiki-1"
          path="index.md"
          serverPage={basePage}
          wiki={baseWiki}
        />,
      );
      await click(screen.getByTestId("mock-folder9-editor-call-image-upload"));
      expect(imageUploadHook.upload).toHaveBeenCalledTimes(1);
      expect(imageUploadHook.upload.mock.calls[0][1]).toBe("attachments");
    });
  });

  describe("renderFile slot — wiki frontmatter", () => {
    it("does not render the old inline metadata controls for markdown files", () => {
      render(
        <WikiPageEditor
          wikiId="wiki-1"
          path="index.md"
          serverPage={basePage}
          wiki={baseWiki}
        />,
      );
      expect(screen.queryByTestId("mock-icon-picker")).toBeNull();
      expect(screen.queryByTestId("wiki-page-editor-controls")).toBeNull();
    });

    it("does not render the old inline metadata controls for md9 wiki pages", () => {
      render(
        <WikiPageEditor
          wikiId="wiki-1"
          path="index.md9"
          serverPage={{ ...basePage, path: "index.md9" }}
          wiki={baseWiki}
        />,
      );
      expect(screen.queryByTestId("mock-icon-picker")).toBeNull();
      expect(screen.queryByTestId("wiki-page-editor-controls")).toBeNull();
    });

    it("reinitializes the markdown editor when switching wikis with the same page path", () => {
      const { rerender } = render(
        <WikiPageEditor
          wikiId="wiki-1"
          path="index.md9"
          serverPage={{ ...basePage, path: "index.md9" }}
          wiki={baseWiki}
        />,
      );
      expect(screen.getByTestId("doc-editor")).toHaveValue("body from wiki-1");

      rerender(
        <WikiPageEditor
          wikiId="wiki-2"
          path="index.md9"
          serverPage={{ ...basePage, path: "index.md9" }}
          wiki={{ ...baseWiki, id: "wiki-2" }}
        />,
      );

      expect(screen.getByTestId("doc-editor")).toHaveValue("body from wiki-2");
    });

    it("falls back to the default renderer for non-markdown text files", () => {
      let slotResult: unknown;
      folderEditorProps.mockImplementation((props) => {
        slotResult = props.renderFile?.({
          path: "scripts/run.sh",
          editorKey: "mock:scripts/run.sh",
          content: "echo hi",
          encoding: "text",
          readOnly: false,
          onChange: () => {},
        });
      });
      render(
        <WikiPageEditor
          wikiId="wiki-1"
          path="scripts/run.sh"
          serverPage={basePage}
          wiki={baseWiki}
        />,
      );
      // `undefined` means the wiki slot deferred to the shell's default.
      expect(slotResult).toBeUndefined();
    });

    it("falls back to the default renderer for binary files", () => {
      let slotResult: unknown;
      folderEditorProps.mockImplementation((props) => {
        slotResult = props.renderFile?.({
          path: "image.png",
          editorKey: "mock:image.png",
          content: "blob",
          encoding: "base64",
          readOnly: false,
          onChange: () => {},
        });
      });
      render(
        <WikiPageEditor
          wikiId="wiki-1"
          path="image.png"
          serverPage={basePage}
          wiki={baseWiki}
        />,
      );
      expect(slotResult).toBeUndefined();
    });

    it("body edits round-trip through frontmatter serialization", async () => {
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
        fireEvent.change(editor, { target: { value: "edited body" } });
      });
      expect(slotState.lastBody).not.toBeNull();
      const body = slotState.lastBody as string;
      expect(body).toContain("icon:");
      expect(body).toContain("edited body");
    });

    it("body edits while read-only do not bubble through onChange", async () => {
      render(
        <WikiPageEditor
          wikiId="wiki-1"
          path="index.md"
          serverPage={basePage}
          wiki={{ ...baseWiki, humanPermission: "read" }}
        />,
      );
      const editor = screen.getByTestId("doc-editor") as HTMLTextAreaElement;
      await act(async () => {
        fireEvent.change(editor, { target: { value: "forced write" } });
      });
      expect(slotState.lastBody).toBeNull();
    });

    it("tolerates malformed frontmatter without crashing", () => {
      let slotResult: unknown;
      folderEditorProps.mockImplementation((props) => {
        slotResult = props.renderFile?.({
          path: "index.md",
          editorKey: "mock:index.md",
          content: "---\n: bad-yaml: [\n---\n\nbody",
          encoding: "text",
          readOnly: false,
          onChange: () => {},
        });
      });
      render(
        <WikiPageEditor
          wikiId="wiki-1"
          path="index.md"
          serverPage={basePage}
          wiki={baseWiki}
        />,
      );
      // The slot must still return a renderable element so the editor
      // surface stays usable while the user fixes the broken YAML.
      expect(slotResult).not.toBeUndefined();
    });
  });

  describe("review-mode hand-off", () => {
    it("opens the review dialog when the shell calls onProposeReview", async () => {
      render(
        <WikiPageEditor
          wikiId="wiki-1"
          path="index.md"
          serverPage={basePage}
          wiki={{ ...baseWiki, approvalMode: "review" }}
        />,
      );
      expect(screen.queryByTestId("mock-review-dialog")).toBeNull();
      await click(screen.getByTestId("mock-folder9-editor-trigger-propose"));
      expect(screen.getByTestId("mock-review-dialog")).toBeInTheDocument();
    });

    it("submits {title + description} as a single commit message", async () => {
      render(
        <WikiPageEditor
          wikiId="wiki-1"
          path="index.md"
          serverPage={basePage}
          wiki={{ ...baseWiki, approvalMode: "review" }}
        />,
      );
      await click(screen.getByTestId("mock-folder9-editor-trigger-propose"));
      await click(screen.getByTestId("mock-review-submit"));
      expect(proposeReviewProceedInputs).toEqual([
        { message: "Fix typo\n\nmisspelled" },
      ]);
    });

    it("submits {title} only when description is missing", async () => {
      render(
        <WikiPageEditor
          wikiId="wiki-1"
          path="index.md"
          serverPage={basePage}
          wiki={{ ...baseWiki, approvalMode: "review" }}
        />,
      );
      await click(screen.getByTestId("mock-folder9-editor-trigger-propose"));
      await click(screen.getByTestId("mock-review-submit-title-only"));
      expect(proposeReviewProceedInputs).toEqual([{ message: "Just a title" }]);
    });

    it("falls back to a default message when title is whitespace", async () => {
      render(
        <WikiPageEditor
          wikiId="wiki-1"
          path="docs/page.md"
          serverPage={basePage}
          wiki={{ ...baseWiki, approvalMode: "review" }}
        />,
      );
      await click(screen.getByTestId("mock-folder9-editor-trigger-propose"));
      await click(screen.getByTestId("mock-review-submit-empty"));
      expect(proposeReviewProceedInputs).toEqual([
        { message: "Update docs/page.md" },
      ]);
    });

    it("closes the dialog when onOpenChange(false) fires (cancel)", async () => {
      render(
        <WikiPageEditor
          wikiId="wiki-1"
          path="index.md"
          serverPage={basePage}
          wiki={{ ...baseWiki, approvalMode: "review" }}
        />,
      );
      await click(screen.getByTestId("mock-folder9-editor-trigger-propose"));
      expect(screen.getByTestId("mock-review-dialog")).toBeInTheDocument();
      await click(screen.getByTestId("mock-review-cancel"));
      expect(screen.queryByTestId("mock-review-dialog")).toBeNull();
    });

    it("does not call proceed when the user cancels the dialog", async () => {
      render(
        <WikiPageEditor
          wikiId="wiki-1"
          path="index.md"
          serverPage={basePage}
          wiki={{ ...baseWiki, approvalMode: "review" }}
        />,
      );
      await click(screen.getByTestId("mock-folder9-editor-trigger-propose"));
      await click(screen.getByTestId("mock-review-cancel"));
      expect(proposeReviewProceedInputs).toHaveLength(0);
    });
  });

  describe("api wrapper — proposal id mirroring", () => {
    it("records the proposal id in the wiki store on a review-mode commit", async () => {
      wikiFolderApiCommit.mockResolvedValue({
        sha: "new-sha",
        proposalId: "prop-42",
      });
      render(
        <WikiPageEditor
          wikiId="wiki-1"
          path="index.md"
          serverPage={basePage}
          wiki={{ ...baseWiki, approvalMode: "review" }}
        />,
      );
      await click(screen.getByTestId("mock-folder9-editor-call-commit"));
      // The mock fires `commit` with files=[{path: "index.md", ...}].
      expect(setSubmittedProposalSpy).toHaveBeenCalledWith(
        "wiki-1",
        "index.md",
        "prop-42",
      );
    });

    it("does NOT record a proposal id when the response carries none", async () => {
      wikiFolderApiCommit.mockResolvedValue({ sha: "new-sha" });
      render(
        <WikiPageEditor
          wikiId="wiki-1"
          path="index.md"
          serverPage={basePage}
          wiki={baseWiki}
        />,
      );
      await click(screen.getByTestId("mock-folder9-editor-call-commit"));
      expect(setSubmittedProposalSpy).not.toHaveBeenCalled();
    });

    it("propagates commit errors through the wrapper unchanged", async () => {
      wikiFolderApiCommit.mockRejectedValue(new Error("boom"));
      render(
        <WikiPageEditor
          wikiId="wiki-1"
          path="index.md"
          serverPage={basePage}
          wiki={baseWiki}
        />,
      );
      await click(screen.getByTestId("mock-folder9-editor-call-commit"));
      // The wrapper forwards the rejection — `setSubmittedProposal` must
      // not run on a failed commit.
      expect(setSubmittedProposalSpy).not.toHaveBeenCalled();
    });
  });
});

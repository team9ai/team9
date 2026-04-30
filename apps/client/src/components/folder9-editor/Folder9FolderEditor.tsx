import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertTriangle, X } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { DocumentEditor } from "@/components/documents/DocumentEditor";
import { useFolderDraft } from "@/hooks/useFolderDraft";
import { getHttpErrorStatus } from "@/lib/http-error";
import { buildFolderTree, type FolderTreeNodeData } from "@/lib/folder-tree";
import i18n from "@/i18n";
import { FolderStatusBar } from "./FolderStatusBar";
import type {
  BlobDto,
  CommitRequest,
  CommitResult,
  Folder9FolderApi,
  TreeEntryDto,
} from "@/services/api/folder9-folder";
import { FolderTreeNode } from "./FolderTreeNode";

/**
 * Coarse permission level used by `<Folder9FolderEditor>`.
 *
 *  - `read`   → editor is mounted in read-only mode; save affordances
 *               are disabled and `api.commit` is never called.
 *  - `propose` → user can edit, but the resulting commit is routed
 *               through the proposal pipeline (`propose: true`) when
 *               the folder is in review-mode.
 *  - `write`  → user can edit and commit directly to the main branch
 *               (`propose: false`) regardless of approval mode.
 *
 * The shell intentionally does NOT compute this from a wiki/routine
 * DTO — callers resolve it from their own permission logic and pass
 * the result in as a prop.
 */
export type Folder9Permission = "read" | "propose" | "write";

/**
 * Approval mode of the folder. `auto` skips the proposal step even
 * for `propose`-permission users; `review` routes any `propose`-perm
 * commit through a proposal branch.
 */
export type Folder9ApprovalMode = "auto" | "review";

/**
 * Optional file-render slot. The shell calls this for each file the
 * user opens; the caller can either return their own UI (e.g. an
 * image preview, a side-by-side diff, a custom editor) or return
 * `undefined` to fall through to the default markdown / textarea
 * editor the shell provides.
 *
 *  - `path`       — the file path inside the folder.
 *  - `content`    — the current in-memory body (already seeded from
 *                   draft / server as applicable).
 *  - `readOnly`   — true iff the shell is in read-only mode (caller
 *                   should disable input affordances accordingly).
 *  - `onChange`   — fire to update the in-memory body. The shell
 *                   takes care of debounced draft persistence.
 */
export interface Folder9RenderFileArgs {
  path: string;
  content: string;
  encoding: "text" | "base64";
  readOnly: boolean;
  onChange: (next: string) => void;
}

/**
 * Optional image-upload injection. When provided, the shell offers
 * image paste / drop handling on the editor body and appends the
 * resulting markdown reference to the current body. Callers that
 * don't supply one disable the paste / drop hooks entirely.
 */
export interface Folder9ImageUploader {
  upload(file: File, basePath?: string): Promise<string>;
}

export interface Folder9FolderEditorProps {
  /**
   * Stable identifier for the folder (e.g. wiki id, routine id). Used
   * to scope React Query cache keys so two editor instances pointed
   * at different folders don't collide.
   */
  folderId: string;
  /**
   * Resolved permission for the current viewer. The shell flips into
   * read-only mode when this is `"read"`.
   */
  permission: Folder9Permission;
  /**
   * Approval mode of the folder. Combined with `permission`, the shell
   * sets the `propose` flag on commit requests.
   */
  approvalMode: Folder9ApprovalMode;
  /**
   * Generic data-layer instance. The shell consumes only the methods
   * declared on `Folder9FolderApi`; pass any factory (`wikiFolderApi`,
   * `routineFolderApi`, or a test stub).
   */
  api: Folder9FolderApi;
  /**
   * Caller-controlled localStorage namespace. The hook composes
   * `team9.folder.draft.${draftKey}.${pathB64}`; callers usually
   * include workspace + identifier + user id so two users on the same
   * machine never clobber each other.
   */
  draftKey: string;
  /**
   * Initially-selected path inside the folder. When `null`, the shell
   * lets the user pick a file from the sidebar before showing any
   * editor. Subsequent navigation is internal to the shell — callers
   * can ignore selection changes.
   */
  initialPath?: string | null;
  /**
   * Optional per-path render slot — see `Folder9RenderFileArgs`.
   */
  renderFile?: (args: Folder9RenderFileArgs) => ReactNode | undefined;
  /**
   * Optional image-upload injection. See `Folder9ImageUploader`.
   */
  imageUpload?: Folder9ImageUploader;
  /**
   * Optional review-mode interceptor. When the shell is in review mode
   * (`approvalMode === "review"` AND `permission === "propose"`) and
   * the user clicks save, the shell calls this callback with a
   * `proceed` continuation instead of committing directly. If not
   * provided, the shell commits with `propose: true` immediately.
   *
   * This lets wiki-side surfaces show a proposal-metadata dialog and
   * call back into `proceed({message})` once the user has supplied
   * the metadata, while the shell itself stays UI-agnostic.
   */
  onProposeReview?: (proceed: (input: ProposeReviewInput) => void) => void;
  /**
   * When `true`, the shell does NOT render its internal tree sidebar
   * and the editor pane fills the full available width. Callers that
   * already render a tree elsewhere (e.g. wiki's workspace
   * sub-sidebar) set this to avoid a duplicate tree.
   *
   * If `hideTree=true` AND `initialPath` is provided, the shell also
   * skips `api.fetchTree()` entirely (saves a roundtrip). When
   * `initialPath` is absent the tree is still fetched so the shell
   * can resolve a default landing path (e.g. `index.md`).
   *
   * Defaults to `false` so callers without an external tree (routine
   * SKILL editor, standalone usage) keep the built-in sidebar.
   */
  hideTree?: boolean;
}

/**
 * Argument passed into the `proceed()` continuation given to
 * `onProposeReview`. The optional `message` overrides the default
 * commit message; everything else is decided by the shell.
 */
export interface ProposeReviewInput {
  message?: string;
}

const FILE_QUERY_KEY = "folder9-folder";

function commitErrorMessage(error: unknown): string {
  const status = getHttpErrorStatus(error);
  if (status === 409) return i18n.t("wiki:editor.errors.saveConflict");
  if (status === 403) return i18n.t("wiki:editor.errors.saveForbidden");
  return i18n.t("wiki:editor.errors.saveFailed");
}

/**
 * Generic folder editor shell.
 *
 * Source-agnostic UI for browsing + editing a folder9 folder. Both
 * the wiki page editor (Phase C.3) and the routine SKILL-folder
 * editor (Phase B in the routine→folder9 plan) mount this shell over
 * a `Folder9FolderApi` instance.
 *
 * Responsibilities (the only things the shell knows about):
 *
 *  - Tree fetch via `api.fetchTree({recursive: true})` and rendering
 *    via `<FolderTreeNode>`.
 *  - Selection + expansion state (held locally — the shell does NOT
 *    push it back through routes or stores).
 *  - Blob fetch on selection via `api.fetchBlob(path)`.
 *  - Draft persistence via `useFolderDraft`.
 *  - Status bar + Cmd/Ctrl-S shortcut wiring.
 *  - Commit pipeline via `api.commit({message, files, propose})` —
 *    the `propose` flag is derived from `approvalMode` × `permission`.
 *
 * Things the shell does NOT know about:
 *
 *  - Routes / sidebars outside the editor pane.
 *  - Wiki-specific UI (icon picker, cover picker, proposal banner,
 *    review dialog). Callers wire these through the `renderFile`
 *    slot or by wrapping the shell.
 *  - Image upload semantics — injected via `imageUpload` prop.
 *  - User identity / workspace identity — folded into `draftKey`.
 */
export function Folder9FolderEditor({
  folderId,
  permission,
  approvalMode,
  api,
  draftKey,
  initialPath = null,
  renderFile,
  imageUpload,
  onProposeReview,
  hideTree = false,
}: Folder9FolderEditorProps) {
  const { t } = useTranslation("wiki");
  const queryClient = useQueryClient();

  const readOnly = permission === "read";
  const isReview = approvalMode === "review" && permission === "propose";

  // --- Tree fetch -------------------------------------------------------

  const treeKey = useMemo(
    () => [FILE_QUERY_KEY, folderId, "tree"] as const,
    [folderId],
  );
  // Skip the network entirely when the host already has the tree (so
  // we hid ours) AND a starting path was provided — there's nothing
  // left for the tree response to feed. When `initialPath` is missing
  // we still fetch so the directory-with-`index.md` convention can
  // resolve a default landing file.
  const treeFetchEnabled = !hideTree || !initialPath;
  const treeQuery = useQuery<TreeEntryDto[]>({
    queryKey: treeKey,
    queryFn: () => api.fetchTree({ recursive: true }),
    enabled: treeFetchEnabled,
  });
  const treeData = useMemo(
    () => (treeQuery.data ? buildFolderTree(treeQuery.data) : []),
    [treeQuery.data],
  );

  // --- Selection + expansion -------------------------------------------

  const [selectedPath, setSelectedPath] = useState<string | null>(initialPath);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(
    () => new Set(),
  );

  const handleSelect = useCallback((path: string) => {
    setSelectedPath(path);
  }, []);

  const handleToggleExpand = useCallback(
    (dirPath: string, hasIndex: boolean) => {
      setExpandedDirs((prev) => {
        const next = new Set(prev);
        if (next.has(dirPath)) {
          next.delete(dirPath);
        } else {
          next.add(dirPath);
        }
        return next;
      });
      if (hasIndex) {
        // Convention: clicking a directory with an `index.md` selects
        // it as a landing page in addition to flipping expansion.
        setSelectedPath(`${dirPath}/index.md`);
      }
    },
    [],
  );

  // --- Blob fetch ------------------------------------------------------

  const blobKey = useMemo(
    () => [FILE_QUERY_KEY, folderId, "blob", selectedPath] as const,
    [folderId, selectedPath],
  );
  const blobQuery = useQuery<BlobDto>({
    queryKey: blobKey,
    queryFn: () => api.fetchBlob(selectedPath!),
    enabled: !!selectedPath,
  });

  // --- Draft + body state ----------------------------------------------

  const serverSnapshot = blobQuery.data
    ? {
        body: blobQuery.data.content,
        frontmatter: {},
        // The shell has no access to per-blob commit metadata; the
        // generic API DTO doesn't carry it. Treat it as epoch 0 so
        // any extant draft surfaces via the stale-alert (callers that
        // care about precise reconciliation can wrap the api).
        lastCommitTime: null,
      }
    : null;

  const {
    draft,
    setDraft,
    clearDraft,
    isDirty,
    hasStaleAlert,
    dismissStaleAlert,
  } = useFolderDraft(draftKey, selectedPath, serverSnapshot);

  // Local body mirrors draft → server. Seed lazily so the first paint
  // already has the right content (the effects below only fire on
  // *subsequent* re-seed events).
  const [body, setBody] = useState<string>(() => "");

  const draftSeededRef = useRef(false);
  const serverSeededRef = useRef(false);

  // Re-seed when the selected path changes — clear the gates so the
  // next blob arrival hydrates fresh state.
  useEffect(() => {
    draftSeededRef.current = false;
    serverSeededRef.current = false;
    setBody("");
  }, [selectedPath]);

  // Hydrate from draft when the hook surfaces one (e.g. async
  // localStorage reconciliation completes after mount).
  useEffect(() => {
    if (!draft) {
      draftSeededRef.current = false;
      return;
    }
    if (draftSeededRef.current) return;
    draftSeededRef.current = true;
    setBody(draft.body);
  }, [draft]);

  // Hydrate from server blob when the fetch resolves and we have no
  // draft. If we're already dirty (user has typed) keep their edits.
  useEffect(() => {
    if (!blobQuery.data) return;
    if (serverSeededRef.current) return;
    if (isDirty) {
      serverSeededRef.current = true;
      return;
    }
    serverSeededRef.current = true;
    setBody(blobQuery.data.content);
  }, [blobQuery.data, isDirty]);

  // Latest-body ref for async closures (image upload completion).
  const latestBodyRef = useRef(body);
  useEffect(() => {
    latestBodyRef.current = body;
  }, [body]);

  const handleBodyChange = useCallback(
    (next: string) => {
      if (readOnly) return;
      setBody(next);
      setDraft({ body: next, frontmatter: {} });
    },
    [readOnly, setDraft],
  );

  // --- Image upload (paste / drop) -------------------------------------

  const handleImageUpload = useCallback(
    async (file: File) => {
      if (!imageUpload) return;
      try {
        const path = await imageUpload.upload(file, "attachments");
        const markdown = `![${file.name}](${path})`;
        const current = latestBodyRef.current;
        const newBody = current
          ? `${current}\n\n${markdown}\n`
          : `${markdown}\n`;
        handleBodyChange(newBody);
      } catch (err) {
        notify(
          err instanceof Error ? err.message : t("editor.notifyUploadFailed"),
        );
      }
    },
    // handleBodyChange's identity intentionally omitted — we read the
    // latest body via ref so the closure stays stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [imageUpload, t],
  );

  function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    if (readOnly || !imageUpload) return;
    const items = e.clipboardData?.items;
    if (!items || items.length === 0) return;
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (item.kind === "file" && item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) void handleImageUpload(file);
      }
    }
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    if (readOnly || !imageUpload) return;
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    const imageFiles = Array.from(files).filter((f) =>
      f.type.startsWith("image/"),
    );
    if (imageFiles.length === 0) return;
    e.preventDefault();
    for (const file of imageFiles) {
      void handleImageUpload(file);
    }
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    if (readOnly || !imageUpload) return;
    e.preventDefault();
  }

  // --- Commit pipeline -------------------------------------------------

  const commit = useMutation<CommitResult, unknown, CommitRequest>({
    mutationFn: (req) => api.commit(req),
    onSuccess: (_res, variables) => {
      // Generic invalidation: the tree may have grown / shrunk; every
      // affected blob is now stale.
      void queryClient.invalidateQueries({ queryKey: treeKey });
      for (const file of variables.files) {
        void queryClient.invalidateQueries({
          queryKey: [FILE_QUERY_KEY, folderId, "blob", file.path],
        });
      }
    },
  });

  // Plain alert is the project's current notification surface (matches
  // WikiPageEditor / HomeMainContent). Swap one-for-one when a real
  // toast component lands.
  function notify(message: string) {
    window.alert(message);
  }

  const runCommit = useCallback(
    async (overrideMessage?: string) => {
      if (!selectedPath) return;
      const message = overrideMessage?.trim() || `Update ${selectedPath}`;
      // The propose hint is recomputed server-side from approval mode
      // × permission; we set it as a client hint so the wire payload
      // still reflects the user's intent (matches wikis behaviour).
      const propose = isReview;
      try {
        await commit.mutateAsync({
          message,
          files: [{ path: selectedPath, content: body, action: "update" }],
          propose,
        });
        if (!propose) {
          // Auto-mode commit succeeded — the draft is now part of the
          // server's copy.
          clearDraft();
        }
        notify(t(propose ? "editor.notifySubmitted" : "editor.notifySaved"));
      } catch (error) {
        notify(commitErrorMessage(error));
      }
    },
    [body, clearDraft, commit, isReview, selectedPath, t],
  );

  // Top-level save trigger. In review mode, defer to `onProposeReview`
  // when provided so wiki can show its dialog; otherwise proceed
  // immediately.
  const handleSave = useCallback(() => {
    if (readOnly) return;
    if (commit.isPending) return;
    if (!selectedPath) return;
    if (!isDirty) return;
    if (isReview && onProposeReview) {
      onProposeReview((input) => {
        void runCommit(input.message);
      });
      return;
    }
    void runCommit();
  }, [
    readOnly,
    commit.isPending,
    isDirty,
    isReview,
    onProposeReview,
    runCommit,
    selectedPath,
  ]);

  // Cmd+S / Ctrl+S shortcut.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isSaveShortcut =
        (e.metaKey || e.ctrlKey) && (e.key === "s" || e.key === "S");
      if (!isSaveShortcut) return;
      e.preventDefault();
      handleSave();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleSave]);

  // --- Render -----------------------------------------------------------

  const canSave = !readOnly;

  return (
    <div data-testid="folder9-folder-editor" className="flex h-full min-h-0">
      {!hideTree && (
        <aside
          data-testid="folder9-folder-tree"
          className="w-64 shrink-0 border-r border-border overflow-auto"
          role="tree"
          aria-label={t("page.title", { defaultValue: "Folder" })}
        >
          {treeQuery.isLoading && (
            <div className="p-3 text-xs text-muted-foreground">
              {t("page.loading", { defaultValue: "Loading…" })}
            </div>
          )}
          {!treeQuery.isLoading &&
            treeData.map((node: FolderTreeNodeData) => (
              <FolderTreeNode
                key={node.path}
                node={node}
                depth={0}
                selectedPath={selectedPath}
                expandedDirs={expandedDirs}
                onSelect={handleSelect}
                onToggleExpand={handleToggleExpand}
              />
            ))}
        </aside>
      )}

      <div className="flex-1 flex flex-col min-h-0">
        <FolderStatusBar
          lastSavedAt={null}
          isDirty={isDirty}
          isSaving={commit.isPending}
          canSave={canSave}
          onSave={handleSave}
        />

        {hasStaleAlert && (
          <div
            role="alert"
            data-testid="folder9-folder-stale-alert"
            className="mx-12 mb-2 px-3 py-2 flex items-start gap-2 text-xs border border-yellow-400/60 bg-yellow-50 dark:bg-yellow-500/10 rounded"
          >
            <AlertTriangle
              size={14}
              className="mt-0.5 shrink-0 text-yellow-600"
            />
            <div className="flex-1">
              {t("editor.staleAlert", {
                defaultValue:
                  "You have a local draft that's newer than the server.",
              })}
            </div>
            <button
              type="button"
              aria-label={t("editor.staleDismissAria", {
                defaultValue: "Dismiss",
              })}
              onClick={dismissStaleAlert}
              data-testid="folder9-folder-stale-alert-dismiss"
              className="text-muted-foreground hover:text-foreground"
            >
              <X size={14} />
            </button>
          </div>
        )}

        <div
          className="flex-1 px-12 pb-8 min-h-0"
          data-testid="folder9-folder-editor-drop-zone"
          onPaste={handlePaste}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
        >
          {selectedPath && blobQuery.data ? (
            <FileBody
              path={selectedPath}
              content={body}
              encoding={blobQuery.data.encoding}
              readOnly={readOnly}
              onChange={handleBodyChange}
              renderFile={renderFile}
            />
          ) : selectedPath ? (
            <div className="p-4 text-xs text-muted-foreground">
              {t("page.loading", { defaultValue: "Loading…" })}
            </div>
          ) : (
            <div
              data-testid="folder9-folder-empty"
              className="p-4 text-xs text-muted-foreground"
            >
              {t("page.empty", {
                defaultValue: "Select a file from the sidebar to get started.",
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface FileBodyProps {
  path: string;
  content: string;
  encoding: "text" | "base64";
  readOnly: boolean;
  onChange: (next: string) => void;
  renderFile?: (args: Folder9RenderFileArgs) => ReactNode | undefined;
}

/**
 * Default file-body renderer. Tries the caller's `renderFile` slot
 * first; if it returns `undefined` (or wasn't provided), falls back
 * to the markdown editor for `.md` files and a plain `<pre>` /
 * `<textarea>` for everything else.
 */
function FileBody({
  path,
  content,
  encoding,
  readOnly,
  onChange,
  renderFile,
}: FileBodyProps) {
  if (renderFile) {
    const custom = renderFile({
      path,
      content,
      encoding,
      readOnly,
      onChange,
    });
    if (custom !== undefined) return <>{custom}</>;
  }

  if (encoding === "base64") {
    // Generic shell can't render arbitrary binary content — callers
    // who need previews provide a `renderFile` slot.
    return (
      <div
        data-testid="folder9-folder-binary"
        className="p-4 text-xs text-muted-foreground"
      >
        Binary file
      </div>
    );
  }

  if (path.toLowerCase().endsWith(".md")) {
    return (
      <DocumentEditor
        key={path}
        initialContent={content}
        onChange={onChange}
        readOnly={readOnly}
      />
    );
  }

  // Non-markdown text fallback — a plain textarea is good enough for
  // SKILL.md-like sources and any other text file the shell stumbles
  // across before a caller wires up a custom renderer.
  return (
    <textarea
      data-testid="folder9-folder-textarea"
      className="w-full h-full font-mono text-sm bg-background border border-border rounded p-2"
      value={content}
      readOnly={readOnly}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

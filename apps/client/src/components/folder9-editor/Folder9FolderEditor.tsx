import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AlertTriangle,
  FilePlus2,
  FolderPlus,
  Loader2,
  Upload,
  X,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { DocumentEditor } from "@/components/documents/DocumentEditor";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useFolderDraft } from "@/hooks/useFolderDraft";
import { getHttpErrorMessage, getHttpErrorStatus } from "@/lib/http-error";
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
  /**
   * Stable key for the current loaded source. Changes when the shell
   * rehydrates a different file/folder snapshot, but not on every keystroke.
   */
  editorKey: string;
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

  /**
   * Which side should host the built-in file tree. Defaults to the
   * original left-side layout; skills use the right-side layout to keep
   * the markdown body in the primary reading column.
   */
  treePosition?: "left" | "right";
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
const AUTO_SAVE_DELAY_MS = 800;
const FOLDER_PLACEHOLDER_FILE = ".folder9keep";

type CreateEntryKind = "file" | "folder";
type FolderEntryKind = "file" | "dir";

const INTERNAL_FILE_DRAG_TYPE = "application/x-team9-folder-file";
const INTERNAL_ENTRY_DRAG_TYPE = "application/x-team9-folder-entry";

function commitErrorMessage(error: unknown): string {
  const status = getHttpErrorStatus(error);
  if (status === 409) return i18n.t("wiki:editor.errors.saveConflict");
  if (status === 403) return i18n.t("wiki:editor.errors.saveForbidden");
  return i18n.t("wiki:editor.errors.saveFailed");
}

function normalizeFolderPath(path: string): string {
  return path.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\/+/g, "/");
}

function fileNameFromPath(path: string): string {
  const normalized = normalizeFolderPath(path);
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

function composeUserPath(input: string, baseDir: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const normalized = normalizeFolderPath(baseDir ? `${baseDir}/${raw}` : raw);
  const parts = normalized.split("/").filter(Boolean);
  if (
    parts.length === 0 ||
    parts.some((part) => part === "." || part === "..")
  ) {
    return null;
  }
  return parts.join("/");
}

function isProbablyTextFile(file: File): boolean {
  if (file.type.startsWith("text/")) return true;
  return /\.(md|mdx|txt|json|ya?ml|toml|csv|tsv|xml|html?|css|scss|js|jsx|ts|tsx|mjs|cjs|py|rb|go|rs|java|kt|swift|sh|bash|zsh|sql|env|gitignore)$/i.test(
    file.name,
  );
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Read failed"));
    reader.readAsText(file);
  });
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const parts = result.split(",");
      resolve(result.includes(",") ? parts[parts.length - 1] : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Read failed"));
    reader.readAsDataURL(file);
  });
}

async function readLocalFileForCommit(
  file: File,
): Promise<{ content: string; encoding: "text" | "base64" }> {
  if (isProbablyTextFile(file)) {
    return { content: await readFileAsText(file), encoding: "text" };
  }
  return { content: await readFileAsBase64(file), encoding: "base64" };
}

function readInternalDrag(
  dataTransfer: DataTransfer,
): { path: string; type: FolderEntryKind } | null {
  const raw = dataTransfer.getData(INTERNAL_ENTRY_DRAG_TYPE);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { path?: unknown; type?: unknown };
      if (
        typeof parsed.path === "string" &&
        (parsed.type === "file" || parsed.type === "dir")
      ) {
        return { path: parsed.path, type: parsed.type };
      }
    } catch {
      return null;
    }
  }

  const legacyFilePath = dataTransfer.getData(INTERNAL_FILE_DRAG_TYPE);
  if (legacyFilePath) return { path: legacyFilePath, type: "file" };
  return null;
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
  treePosition = "left",
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
  const [createEntryKind, setCreateEntryKind] =
    useState<CreateEntryKind | null>(null);
  const [createEntryName, setCreateEntryName] = useState("");
  const [createEntryError, setCreateEntryError] = useState<string | null>(null);
  const [createEntryBaseDir, setCreateEntryBaseDir] = useState("");
  const [treeOperationLabel, setTreeOperationLabel] = useState<string | null>(
    null,
  );
  const isTreeOperationPending = treeOperationLabel !== null;
  const [dropTargetKey, setDropTargetKey] = useState<string | null>(null);

  useEffect(() => {
    setSelectedPath(initialPath ?? null);
  }, [folderId, initialPath]);

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
  const [editorSeedVersion, setEditorSeedVersion] = useState(0);

  const draftSeededRef = useRef(false);
  const serverSeededRef = useRef(false);
  const hasLocalEditRef = useRef(false);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAutoSavedSignatureRef = useRef<string | null>(null);
  const failedAutoSaveSignatureRef = useRef<string | null>(null);
  const latestSelectedPathRef = useRef<string | null>(selectedPath);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const uploadTargetDirectoryRef = useRef<string>("");

  const activeDirectoryPath = useMemo(() => {
    if (!selectedPath) return "";
    const normalized = normalizeFolderPath(selectedPath);
    const parts = normalized.split("/").filter(Boolean);
    if (parts[parts.length - 1] === FOLDER_PLACEHOLDER_FILE) {
      return parts.slice(0, -1).join("/");
    }
    if (parts.length <= 1) return "";
    return parts.slice(0, -1).join("/");
  }, [selectedPath]);

  useEffect(() => {
    latestSelectedPathRef.current = selectedPath;
  }, [selectedPath]);

  // Re-seed when the selected path changes — clear the gates so the
  // next blob arrival hydrates fresh state.
  useEffect(() => {
    draftSeededRef.current = false;
    serverSeededRef.current = false;
    hasLocalEditRef.current = false;
    lastAutoSavedSignatureRef.current = null;
    failedAutoSaveSignatureRef.current = null;
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    setBody("");
    setEditorSeedVersion((version) => version + 1);
  }, [folderId, selectedPath]);

  useEffect(
    () => () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    },
    [],
  );

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
    setEditorSeedVersion((version) => version + 1);
  }, [draft]);

  // Hydrate from server blob when the fetch resolves and we have no
  // draft. If we're already dirty (user has typed) keep their edits.
  useEffect(() => {
    if (!blobQuery.data) return;
    if (serverSeededRef.current) return;
    if (isDirty) return;
    serverSeededRef.current = true;
    setBody(blobQuery.data.content);
    setEditorSeedVersion((version) => version + 1);
  }, [blobQuery.data, isDirty]);

  // Latest-body ref for async closures (image upload completion).
  const latestBodyRef = useRef(body);
  useEffect(() => {
    latestBodyRef.current = body;
  }, [body]);

  const handleBodyChange = useCallback(
    (next: string) => {
      if (readOnly) return;
      hasLocalEditRef.current = true;
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
        if (readOnly) return;
        // I4 — race-safe append.
        //
        // Two concurrent paste-uploads completing near-simultaneously
        // both used to read `latestBodyRef.current`, append, then write
        // back. Reading + writing the ref in two non-atomic steps lets
        // upload B clobber upload A's append. Fix: do BOTH the read
        // and the write on the ref atomically so each upload sees the
        // accumulated body. Then mirror the same value to React state
        // (functional setter avoids the analogous race in
        // setState-from-stale-closure) and to the draft store. The
        // ref is the single source of truth for "current accumulated
        // body" while edits are in flight.
        const next = latestBodyRef.current
          ? `${latestBodyRef.current}\n\n${markdown}\n`
          : `${markdown}\n`;
        latestBodyRef.current = next;
        hasLocalEditRef.current = true;
        setBody(next);
        setDraft({ body: next, frontmatter: {} });
      } catch (err) {
        notify(
          err instanceof Error ? err.message : t("editor.notifyUploadFailed"),
        );
      }
    },
    // setBody/setDraft are stable; readOnly may flip between renders so
    // include it. handleBodyChange is no longer used here.
    [imageUpload, readOnly, setDraft, t],
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
    onSuccess: async (_res, variables) => {
      // Generic invalidation: the tree may have grown / shrunk; every
      // affected blob is now stale.
      const invalidations: Promise<unknown>[] = [
        queryClient.invalidateQueries({ queryKey: treeKey }),
      ];
      for (const file of variables.files) {
        if (file.action !== "delete") {
          queryClient.setQueryData<BlobDto>(
            [FILE_QUERY_KEY, folderId, "blob", file.path],
            (current) => ({
              path: file.path,
              content: file.content,
              encoding: file.encoding ?? current?.encoding ?? "text",
            }),
          );
        }
        invalidations.push(
          queryClient.invalidateQueries({
            queryKey: [FILE_QUERY_KEY, folderId, "blob", file.path],
          }),
        );
      }
      await Promise.all(invalidations);
    },
  });

  // Plain alert is the project's current notification surface (matches
  // WikiPageEditor / HomeMainContent). Swap one-for-one when a real
  // toast component lands.
  function notify(message: string) {
    window.alert(message);
  }

  async function commitFiles(
    message: string,
    files: CommitRequest["files"],
    options: { pendingLabel?: string } = {},
  ): Promise<boolean> {
    if (
      readOnly ||
      commit.isPending ||
      isTreeOperationPending ||
      files.length === 0
    ) {
      return false;
    }
    const propose = isReview;
    if (options.pendingLabel) setTreeOperationLabel(options.pendingLabel);
    try {
      await commit.mutateAsync({ message, files, propose });
      if (!propose) {
        notify(t("editor.notifySaved"));
      } else {
        notify(t("editor.notifySubmitted"));
      }
      return true;
    } catch (error) {
      notify(commitErrorMessage(error));
      return false;
    } finally {
      if (options.pendingLabel) setTreeOperationLabel(null);
    }
  }

  function openCreateEntryDialog(
    kind: CreateEntryKind,
    baseDir = activeDirectoryPath,
  ) {
    if (readOnly || commit.isPending || isTreeOperationPending) return;
    setCreateEntryKind(kind);
    setCreateEntryBaseDir(normalizeFolderPath(baseDir));
    setCreateEntryName(kind === "file" ? "untitled.md" : "new-folder");
    setCreateEntryError(null);
  }

  async function submitCreateEntry(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!createEntryKind || readOnly || commit.isPending) return;

    if (createEntryKind === "file") {
      const path = composeUserPath(createEntryName, createEntryBaseDir);
      if (!path || path.endsWith("/")) {
        setCreateEntryError(
          t("tree.invalidPath", { defaultValue: "Invalid path" }),
        );
        return;
      }

      const didCommit = await commitFiles(
        `Create ${path}`,
        [{ path, content: "", encoding: "text", action: "create" }],
        {
          pendingLabel: t("tree.creatingFile", {
            defaultValue: "Creating file...",
          }),
        },
      );
      if (didCommit) {
        setSelectedPath(path);
        setCreateEntryKind(null);
      }
      return;
    }

    const folderPath = composeUserPath(createEntryName, createEntryBaseDir);
    if (!folderPath) {
      setCreateEntryError(
        t("tree.invalidPath", { defaultValue: "Invalid path" }),
      );
      return;
    }
    const placeholderPath = `${folderPath}/${FOLDER_PLACEHOLDER_FILE}`;
    const didCommit = await commitFiles(
      `Create ${folderPath}`,
      [
        {
          path: placeholderPath,
          content: "",
          encoding: "text",
          action: "create",
        },
      ],
      {
        pendingLabel: t("tree.creatingFolder", {
          defaultValue: "Creating folder...",
        }),
      },
    );
    if (!didCommit) return;
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      const parts = folderPath.split("/");
      for (let i = 1; i <= parts.length; i += 1) {
        next.add(parts.slice(0, i).join("/"));
      }
      return next;
    });
    setCreateEntryKind(null);
  }

  function handleUploadClick(baseDir = activeDirectoryPath) {
    if (readOnly || commit.isPending || isTreeOperationPending) return;
    uploadTargetDirectoryRef.current = normalizeFolderPath(baseDir);
    uploadInputRef.current?.click();
  }

  async function uploadFilesToDirectory(files: File[], baseDir: string) {
    const targetDir = normalizeFolderPath(baseDir);
    const changes: CommitRequest["files"] = [];

    for (const file of files) {
      const path = composeUserPath(file.name, targetDir);
      if (!path) {
        throw new Error(
          t("tree.invalidPath", { defaultValue: "Invalid path" }),
        );
      }
      const payload = await readLocalFileForCommit(file);
      changes.push({
        path,
        content: payload.content,
        encoding: payload.encoding,
        action: "create",
      });
    }

    const didCommit = await commitFiles(
      files.length === 1
        ? `Upload ${files[0].name}`
        : `Upload ${files.length} files`,
      changes,
      {
        pendingLabel: t("tree.uploading", { defaultValue: "Uploading..." }),
      },
    );
    if (didCommit && changes[0]) setSelectedPath(changes[0].path);
  }

  async function handleUploadFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (
      readOnly ||
      commit.isPending ||
      isTreeOperationPending ||
      files.length === 0
    ) {
      return;
    }

    try {
      await uploadFilesToDirectory(files, uploadTargetDirectoryRef.current);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Upload failed");
    } finally {
      uploadTargetDirectoryRef.current = "";
    }
  }

  function handleDropFilesInDirectory(baseDir: string, files: File[]) {
    if (
      readOnly ||
      commit.isPending ||
      isTreeOperationPending ||
      files.length === 0
    ) {
      return;
    }
    void uploadFilesToDirectory(files, baseDir).catch((error: unknown) => {
      notify(error instanceof Error ? error.message : "Upload failed");
    });
  }

  async function readBlobForMove(path: string): Promise<BlobDto> {
    return (
      queryClient.getQueryData<BlobDto>([
        FILE_QUERY_KEY,
        folderId,
        "blob",
        path,
      ]) ?? (await api.fetchBlob(path))
    );
  }

  function expandDirectoryPath(dirPath: string) {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      const parts = normalizeFolderPath(dirPath).split("/").filter(Boolean);
      for (let i = 1; i <= parts.length; i += 1) {
        next.add(parts.slice(0, i).join("/"));
      }
      return next;
    });
  }

  async function moveEntryToDirectory(
    sourcePath: string,
    sourceType: FolderEntryKind,
    baseDir: string,
  ) {
    if (readOnly || commit.isPending || isTreeOperationPending) return;
    const normalizedSource = normalizeFolderPath(sourcePath);
    const fileName = fileNameFromPath(normalizedSource);
    const targetDir = normalizeFolderPath(baseDir);
    if (!fileName) return;

    try {
      let targetPath = composeUserPath(fileName, targetDir);
      const changes: CommitRequest["files"] = [];

      if (sourceType === "file") {
        if (!targetPath || targetPath === normalizedSource) return;
        const sourceBlob =
          selectedPath === normalizedSource && blobQuery.data
            ? {
                content: body,
                encoding: blobQuery.data.encoding,
              }
            : await readBlobForMove(normalizedSource);
        changes.push(
          {
            path: targetPath,
            content: sourceBlob.content,
            encoding: sourceBlob.encoding,
            action: "create",
          },
          {
            path: normalizedSource,
            content: "",
            encoding: "text",
            action: "delete",
          },
        );
      } else {
        if (
          !targetPath ||
          targetPath === normalizedSource ||
          targetDir === normalizedSource ||
          targetDir.startsWith(`${normalizedSource}/`)
        ) {
          return;
        }

        const sourcePrefix = `${normalizedSource}/`;
        const sourceEntries = (treeQuery.data ?? []).filter(
          (entry) =>
            entry.type === "file" &&
            normalizeFolderPath(entry.path).startsWith(sourcePrefix),
        );
        if (sourceEntries.length === 0) return;

        for (const entry of sourceEntries) {
          const sourceFilePath = normalizeFolderPath(entry.path);
          const relativePath = sourceFilePath
            .slice(sourcePrefix.length)
            .replace(/^\/+/, "");
          const destinationPath = `${targetPath}/${relativePath}`;
          const sourceBlob =
            selectedPath === sourceFilePath && blobQuery.data
              ? {
                  content: body,
                  encoding: blobQuery.data.encoding,
                }
              : await readBlobForMove(sourceFilePath);
          changes.push(
            {
              path: destinationPath,
              content: sourceBlob.content,
              encoding: sourceBlob.encoding,
              action: "create",
            },
            {
              path: sourceFilePath,
              content: "",
              encoding: "text",
              action: "delete",
            },
          );
        }
      }

      const didCommit = await commitFiles(
        `Move ${normalizedSource} to ${targetPath}`,
        changes,
        { pendingLabel: t("tree.moving", { defaultValue: "Moving..." }) },
      );
      if (!didCommit) return;

      if (
        selectedPath === normalizedSource ||
        selectedPath?.startsWith(`${normalizedSource}/`)
      ) {
        const selectedRelative = selectedPath
          .slice(normalizedSource.length)
          .replace(/^\/+/, "");
        targetPath = selectedRelative
          ? `${targetPath}/${selectedRelative}`
          : targetPath;
        clearDraft();
        setSelectedPath(targetPath);
      }
      expandDirectoryPath(targetDir);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Move failed");
    }
  }

  function canDropOnRoot(e: React.DragEvent<HTMLElement>): boolean {
    if (readOnly || commit.isPending || isTreeOperationPending) return false;
    const types = Array.from(e.dataTransfer.types);
    return (
      (types.includes("Files") && !!handleDropFilesInDirectory) ||
      types.includes(INTERNAL_ENTRY_DRAG_TYPE) ||
      types.includes(INTERNAL_FILE_DRAG_TYPE)
    );
  }

  function handleRootDragOver(e: React.DragEvent<HTMLElement>) {
    if (!canDropOnRoot(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = Array.from(e.dataTransfer.types).includes(
      "Files",
    )
      ? "copy"
      : "move";
    setDropTargetKey("root");
  }

  function handleRootDragLeave(e: React.DragEvent<HTMLElement>) {
    const related = e.relatedTarget;
    if (related instanceof Node && e.currentTarget.contains(related)) return;
    setDropTargetKey(null);
  }

  function handleRootDrop(e: React.DragEvent<HTMLElement>) {
    if (!canDropOnRoot(e)) return;
    e.preventDefault();
    setDropTargetKey(null);

    const internal = readInternalDrag(e.dataTransfer);
    if (internal) {
      void moveEntryToDirectory(internal.path, internal.type, "");
      return;
    }

    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length > 0) handleDropFilesInDirectory("", files);
  }

  const runCommit = useCallback(
    async (
      overrideMessage?: string,
      options?: { silentSuccess?: boolean; autoSaveSignature?: string },
    ) => {
      if (!selectedPath) return;
      const committedPath = selectedPath;
      const committedBody = body;
      const message = overrideMessage?.trim() || `Update ${committedPath}`;
      // The propose hint is recomputed server-side from approval mode
      // × permission; we set it as a client hint so the wire payload
      // still reflects the user's intent (matches wikis behaviour).
      const propose = isReview;
      try {
        await commit.mutateAsync({
          message,
          files: [
            { path: committedPath, content: committedBody, action: "update" },
          ],
          propose,
        });
        if (options?.autoSaveSignature) {
          lastAutoSavedSignatureRef.current = options.autoSaveSignature;
          if (
            failedAutoSaveSignatureRef.current === options.autoSaveSignature
          ) {
            failedAutoSaveSignatureRef.current = null;
          }
        }
        if (!propose) {
          // Auto-mode commit succeeded — the draft is now part of the
          // server's copy. If the user typed again while the commit was
          // in flight, keep that newer draft and let the next debounce
          // save it instead of clearing it out from under them.
          if (
            latestSelectedPathRef.current === committedPath &&
            latestBodyRef.current === committedBody
          ) {
            clearDraft();
            hasLocalEditRef.current = false;
          }
        }
        if (!options?.silentSuccess) {
          notify(t(propose ? "editor.notifySubmitted" : "editor.notifySaved"));
        }
      } catch (error) {
        if (options?.autoSaveSignature) {
          failedAutoSaveSignatureRef.current = options.autoSaveSignature;
        }
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
    if (isTreeOperationPending) return;
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
    isTreeOperationPending,
    isDirty,
    isReview,
    onProposeReview,
    runCommit,
    selectedPath,
  ]);

  // Direct-write edits save themselves after the user pauses typing.
  // Review proposals still require the explicit submit dialog because
  // the commit needs proposal metadata.
  useEffect(() => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    const canAutoSave = !readOnly && !isReview;
    if (
      !canAutoSave ||
      !selectedPath ||
      !isDirty ||
      commit.isPending ||
      isTreeOperationPending ||
      !hasLocalEditRef.current
    ) {
      return;
    }

    const signature = `${selectedPath}\0${body}`;
    if (
      lastAutoSavedSignatureRef.current === signature ||
      failedAutoSaveSignatureRef.current === signature
    ) {
      return;
    }

    autoSaveTimerRef.current = setTimeout(() => {
      autoSaveTimerRef.current = null;
      void runCommit(undefined, {
        silentSuccess: true,
        autoSaveSignature: signature,
      });
    }, AUTO_SAVE_DELAY_MS);

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, [
    body,
    commit.isPending,
    isDirty,
    isReview,
    isTreeOperationPending,
    readOnly,
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

  const treePanel = !hideTree ? (
    <aside
      data-testid="folder9-folder-tree"
      className={`w-64 shrink-0 border-border overflow-auto ${
        treePosition === "right" ? "border-l" : "border-r"
      } ${dropTargetKey === "root" ? "bg-primary/5 ring-1 ring-inset ring-primary/20" : ""}`}
      role="tree"
      aria-label={t("page.title", { defaultValue: "Folder" })}
      onDragOver={handleRootDragOver}
      onDragLeave={handleRootDragLeave}
      onDrop={handleRootDrop}
    >
      {!readOnly && (
        <div className="flex items-center gap-1 p-2 border-b border-border">
          <button
            type="button"
            aria-label={t("tree.newFile", { defaultValue: "New file" })}
            title={t("tree.newFile", { defaultValue: "New file" })}
            onClick={() => openCreateEntryDialog("file", activeDirectoryPath)}
            disabled={commit.isPending || isTreeOperationPending}
            className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            <FilePlus2 size={15} />
          </button>
          <button
            type="button"
            aria-label={t("tree.newFolder", { defaultValue: "New folder" })}
            title={t("tree.newFolder", { defaultValue: "New folder" })}
            onClick={() => openCreateEntryDialog("folder", activeDirectoryPath)}
            disabled={commit.isPending || isTreeOperationPending}
            className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            <FolderPlus size={15} />
          </button>
          <button
            type="button"
            aria-label={t("tree.uploadFile", { defaultValue: "Upload file" })}
            title={t("tree.uploadFile", { defaultValue: "Upload file" })}
            onClick={() => handleUploadClick(activeDirectoryPath)}
            disabled={commit.isPending || isTreeOperationPending}
            className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            <Upload size={15} />
          </button>
          <input
            ref={uploadInputRef}
            data-testid="folder9-folder-upload-input"
            type="file"
            multiple
            className="hidden"
            onChange={(e) => void handleUploadFiles(e)}
          />
        </div>
      )}
      {treeQuery.isLoading && (
        <div className="p-3 text-xs text-muted-foreground">
          {t("page.loading", { defaultValue: "Loading…" })}
        </div>
      )}
      {treeOperationLabel && (
        <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs text-muted-foreground">
          <Loader2 size={13} className="animate-spin" />
          <span>{treeOperationLabel}</span>
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
            readOnly={readOnly || isTreeOperationPending}
            onCreateFileInDirectory={(dirPath) =>
              openCreateEntryDialog("file", dirPath)
            }
            onCreateFolderInDirectory={(dirPath) =>
              openCreateEntryDialog("folder", dirPath)
            }
            onUploadInDirectory={(dirPath) => handleUploadClick(dirPath)}
            onDropFilesInDirectory={handleDropFilesInDirectory}
            onMoveEntryToDirectory={(sourcePath, sourceType, dirPath) =>
              void moveEntryToDirectory(sourcePath, sourceType, dirPath)
            }
            dropTargetKey={dropTargetKey}
            onDropTargetChange={setDropTargetKey}
          />
        ))}
    </aside>
  ) : null;

  return (
    <div data-testid="folder9-folder-editor" className="flex h-full min-h-0">
      {treePosition === "left" && treePanel}

      <div className="flex-1 flex flex-col min-h-0">
        <FolderStatusBar
          lastSavedAt={null}
          isDirty={isDirty}
          isSaving={commit.isPending || isTreeOperationPending}
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
              editorKey={`${folderId}:${selectedPath}:${editorSeedVersion}`}
              path={selectedPath}
              content={body}
              encoding={blobQuery.data.encoding}
              readOnly={readOnly}
              onChange={handleBodyChange}
              renderFile={renderFile}
            />
          ) : selectedPath && blobQuery.isError ? (
            <div className="p-4 text-xs text-destructive">
              {getHttpErrorMessage(blobQuery.error) ||
                t("page.loadError", {
                  defaultValue: "Failed to load this file.",
                })}
            </div>
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

      {treePosition === "right" && treePanel}

      <Dialog
        open={createEntryKind !== null}
        onOpenChange={(open) => {
          if (!open) setCreateEntryKind(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <form
            onSubmit={(e) => void submitCreateEntry(e)}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>
                {createEntryKind === "folder"
                  ? t("tree.newFolder", { defaultValue: "New folder" })
                  : t("tree.newFile", { defaultValue: "New file" })}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-2">
              <label
                className="text-sm font-medium"
                htmlFor="folder9-entry-name"
              >
                {t("tree.name", { defaultValue: "Name" })}
              </label>
              <Input
                id="folder9-entry-name"
                value={createEntryName}
                onChange={(e) => {
                  setCreateEntryName(e.target.value);
                  setCreateEntryError(null);
                }}
                autoFocus
              />
              {createEntryBaseDir && (
                <div className="text-xs text-muted-foreground">
                  {createEntryBaseDir}/
                </div>
              )}
              {createEntryError && (
                <div className="text-xs text-destructive">
                  {createEntryError}
                </div>
              )}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateEntryKind(null)}
                disabled={commit.isPending || isTreeOperationPending}
              >
                {t("common.cancel", { defaultValue: "Cancel" })}
              </Button>
              <Button
                type="submit"
                disabled={
                  commit.isPending ||
                  isTreeOperationPending ||
                  createEntryName.trim().length === 0
                }
              >
                {t("common.create", { defaultValue: "Create" })}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface FileBodyProps {
  editorKey: string;
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
  editorKey,
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
      editorKey,
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
        key={editorKey}
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

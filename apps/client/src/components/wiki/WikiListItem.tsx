import { useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  Archive,
  ChevronDown,
  ChevronRight,
  Library as LibraryIcon,
  MoreHorizontal,
  Plus,
  Settings,
  Upload,
} from "lucide-react";
import { useWikiTree } from "@/hooks/useWikiTree";
import { queryClient } from "@/lib/query-client";
import {
  useSelectedWikiId,
  useWikiStore,
  wikiActions,
} from "@/stores/useWikiStore";
import { buildTree } from "@/lib/wiki-tree";
import {
  DEFAULT_WIKI_INDEX_FILENAME,
  DEFAULT_WIKI_INDEX_PATH,
  LEGACY_WIKI_INDEX_FILENAME,
  stripWikiPageExtension,
} from "@/lib/wiki-paths";
import { wikisApi } from "@/services/api/wikis";
import { useWikiPage } from "@/hooks/useWikiPage";
import { wikiKeys } from "@/hooks/useWikis";
import { WikiTreeNode } from "./WikiTreeNode";
import { WikiSettingsDialog } from "./WikiSettingsDialog";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useArchiveWiki } from "@/hooks/useWikis";
import { getHttpErrorMessage, getHttpErrorStatus } from "@/lib/http-error";
import i18n from "@/i18n";
import { cn } from "@/lib/utils";
import type { WikiDto } from "@/types/wiki";

interface WikiListItemProps {
  wiki: WikiDto;
}

/**
 * Uses the shared `i18n.t` accessor (rather than the hook's bound `t`) so
 * the helper can stay a plain function outside the component closure — the
 * wiki namespace is eagerly registered in `@/i18n`, so `t` is safe to call
 * at module scope. Keys are intentionally shared with `WikiSettingsDialog`
 * since the copy itself is identical between both archive entry points.
 */
function archiveErrorMessage(error: unknown): string {
  const status = getHttpErrorStatus(error);
  if (status === 403) {
    return i18n.t("wiki:settings.errors.archiveForbidden");
  }
  const serverMsg = getHttpErrorMessage(error);
  if (serverMsg) {
    return i18n.t("wiki:settings.errors.archiveFailedWithMessage", {
      message: serverMsg,
    });
  }
  return i18n.t("wiki:settings.errors.archiveFailed");
}

function normalizePageFolderIndexPath(input: string): string | null {
  let trimmed = input.trim().replace(/^\/+|\/+$/g, "");
  if (!trimmed) return null;
  trimmed = trimmed.replace(/\.md9?$/i, "");
  if (!trimmed) return null;
  return `${trimmed}/${DEFAULT_WIKI_INDEX_FILENAME}`;
}

function uniqueFolderIndexPath(
  path: string,
  existingPaths: Set<string>,
): string {
  if (!existingPaths.has(path)) return path;
  const suffix = `/${DEFAULT_WIKI_INDEX_FILENAME}`;
  const folderPath = path.endsWith(suffix)
    ? path.slice(0, -suffix.length)
    : path;
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${folderPath}-${i}${suffix}`;
    if (!existingPaths.has(candidate)) return candidate;
  }
  return `${folderPath}-${Date.now()}${suffix}`;
}

function bytesToBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < view.length; i += chunkSize) {
    const chunk = view.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function fileToBase64(file: File): Promise<string> {
  return bytesToBase64(await file.arrayBuffer());
}

function uploadPathForFile(file: File): string {
  const relativePath =
    typeof (file as File & { webkitRelativePath?: string })
      .webkitRelativePath === "string"
      ? (file as File & { webkitRelativePath: string }).webkitRelativePath
      : "";
  const rawPath = relativePath.trim() || file.name;
  return rawPath
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean)
    .join("/");
}

/**
 * One wiki row in the sub-sidebar. The wiki tree is lazy-loaded — the
 * `useWikiTree` query is disabled until the user expands this row, so
 * opening the sidebar with many wikis costs exactly one list fetch and
 * zero tree fetches.
 *
 * A hover-visible kebab menu exposes per-wiki actions:
 *   • Settings — opens `WikiSettingsDialog`
 *   • Archive  — opens a confirmation directly (bypasses settings so the
 *                 user can archive without scrolling to the danger zone)
 *
 * The expanded state lives in the shared wiki store under the `wiki:<id>`
 * key so a later navigation (e.g. coming back from a deep link) can
 * auto-expand this row without duplicating bookkeeping.
 */
export function WikiListItem({ wiki }: WikiListItemProps) {
  const { t } = useTranslation("wiki");
  const expandKey = `wiki:${wiki.id}`;
  // Scoped per-wiki selector: only re-renders this row when its own
  // expansion state flips, not when any other wiki toggles.
  const isOpen = useWikiStore((s) => s.expandedDirectories.has(expandKey));

  const { data: entries } = useWikiTree(isOpen ? wiki.id : null);
  const tree = useMemo(() => (entries ? buildTree(entries) : []), [entries]);
  const visibleTree = useMemo(
    () =>
      tree.filter(
        (node) =>
          !(
            node.type === "file" &&
            (node.name === DEFAULT_WIKI_INDEX_FILENAME ||
              node.name === LEGACY_WIKI_INDEX_FILENAME)
          ),
      ),
    [tree],
  );

  const [showSettings, setShowSettings] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isCreatingFile, setIsCreatingFile] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedUploadFiles, setSelectedUploadFiles] = useState<File[]>([]);
  const [uploadProposalId, setUploadProposalId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const archiveWiki = useArchiveWiki();
  const isArchiving = archiveWiki.isPending;

  const navigate = useNavigate();
  const selectedWikiId = useSelectedWikiId();
  const selectedPagePath = useWikiStore((s) => s.selectedPagePath);
  const shouldReadRootDocument = isOpen || selectedWikiId === wiki.id;
  const { data: rootPage } = useWikiPage(
    wiki.id,
    shouldReadRootDocument ? DEFAULT_WIKI_INDEX_PATH : null,
  );
  const isRootDocumentSelected =
    selectedWikiId === wiki.id && selectedPagePath === DEFAULT_WIKI_INDEX_PATH;
  const rootTitle =
    typeof rootPage?.frontmatter.title === "string" &&
    rootPage.frontmatter.title.trim().length > 0
      ? rootPage.frontmatter.title.trim()
      : wiki.name;
  const rootIcon =
    typeof rootPage?.frontmatter.icon === "string" &&
    rootPage.frontmatter.icon.trim().length > 0
      ? rootPage.frontmatter.icon.trim()
      : wiki.icon;
  const existingPaths = useMemo(
    () =>
      new Set(
        (entries ?? []).filter((e) => e.type === "file").map((e) => e.path),
      ),
    [entries],
  );
  const selectedUploadPaths = useMemo(
    () => selectedUploadFiles.map(uploadPathForFile).filter(Boolean),
    [selectedUploadFiles],
  );

  // Note: a second invocation while the first is still pending is
  // prevented by the confirm button's `disabled` attribute (the button is
  // the sole entry point). That keeps the function body focused on the
  // happy / error paths.
  //
  // On success, if this row represents the *currently-selected* wiki, we
  // push the user back to the empty `/wiki` state — the route they're on
  // (`/wiki/<slug>/...`) is about to 404 because the wiki list no longer
  // includes this one. `WikiSettingsDialog` does the same thing after its
  // own archive flow; we mirror that behaviour here so archiving from the
  // kebab is equally safe regardless of which entry point the user picked.
  const handleArchiveConfirm = async () => {
    try {
      await archiveWiki.mutateAsync(wiki.id);
      setShowArchiveConfirm(false);
      if (selectedWikiId === wiki.id) {
        navigate({ to: "/wiki" });
      }
    } catch (error) {
      setShowArchiveConfirm(false);
      window.alert(archiveErrorMessage(error));
    }
  };

  const handleOpenRootDocument = () => {
    wikiActions.expandDirectory(expandKey);
    wikiActions.setSelectedWiki(wiki.id);
    wikiActions.setSelectedPage(DEFAULT_WIKI_INDEX_PATH);
    navigate({
      to: "/wiki/$wikiSlug/$",
      params: { wikiSlug: wiki.slug, _splat: DEFAULT_WIKI_INDEX_PATH },
    });
  };

  const refreshAfterCreate = (path: string) => {
    wikiActions.expandDirectory(expandKey);
    wikiActions.setSelectedWiki(wiki.id);
    wikiActions.setSelectedPage(path);
    navigate({
      to: "/wiki/$wikiSlug/$",
      params: { wikiSlug: wiki.slug, _splat: path },
    });
    void queryClient.invalidateQueries({ queryKey: wikiKeys.trees(wiki.id) });
    void queryClient.invalidateQueries({ queryKey: wikiKeys.pages(wiki.id) });
  };

  const createFile = async (
    path: string,
    content: string,
    encoding: "text" | "base64",
  ): Promise<boolean> => {
    setIsCreatingFile(true);
    try {
      await wikisApi.commit(wiki.id, {
        message: `Create ${path}`,
        files: [{ path, content, encoding, action: "create" }],
      });
      refreshAfterCreate(path);
      return true;
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Create failed");
      return false;
    } finally {
      setIsCreatingFile(false);
    }
  };

  const handleCreatePage = () => {
    if (isCreatingFile) return;
    const normalized = normalizePageFolderIndexPath("untitled");
    if (!normalized) return;
    const path = uniqueFolderIndexPath(normalized, existingPaths);
    const pathSegments = path.split("/");
    const title = pathSegments[pathSegments.length - 2] ?? "untitled";
    void createFile(
      path,
      `---\nsummary: ""\n---\n\n# ${stripWikiPageExtension(title)}\n\n`,
      "text",
    );
  };

  const handleCreateChildPage = (parentPath: string) => {
    if (isCreatingFile) return;
    const normalizedParent = parentPath.trim().replace(/^\/+|\/+$/g, "");
    const normalized = normalizePageFolderIndexPath(
      normalizedParent ? `${normalizedParent}/untitled` : "untitled",
    );
    if (!normalized) return;
    const path = uniqueFolderIndexPath(normalized, existingPaths);
    const pathSegments = path.split("/");
    const title = pathSegments[pathSegments.length - 2] ?? "untitled";
    void createFile(
      path,
      `---\nsummary: ""\n---\n\n# ${stripWikiPageExtension(title)}\n\n`,
      "text",
    );
  };

  const handleOpenUploadDialog = () => {
    setSelectedUploadFiles([]);
    setUploadProposalId(null);
    setUploadError(null);
    setShowUploadDialog(true);
  };

  const handleUploadFilesSelected = (files: FileList | null) => {
    const nextFiles = Array.from(files ?? []);
    setSelectedUploadFiles((current) => {
      const byPath = new Map(
        current.map((file) => [uploadPathForFile(file), file]),
      );
      for (const file of nextFiles) {
        byPath.set(uploadPathForFile(file), file);
      }
      return Array.from(byPath.values());
    });
    setUploadProposalId(null);
    setUploadError(null);
  };

  const handleUploadSubmit = async () => {
    if (selectedUploadFiles.length === 0 || isUploading) return;
    setIsUploading(true);
    setUploadError(null);
    try {
      const files = await Promise.all(
        selectedUploadFiles.map(async (file) => ({
          path: uploadPathForFile(file),
          content: await fileToBase64(file),
          encoding: "base64" as const,
          action: "create" as const,
        })),
      );
      const result = await wikisApi.commit(wiki.id, {
        message: `Upload ${files.length} ${files.length === 1 ? "file" : "files"}`,
        files,
        propose: true,
      });
      setUploadProposalId(result.proposal?.id ?? result.commit.sha);
      void queryClient.invalidateQueries({
        queryKey: wikiKeys.proposals(wiki.id),
      });
      void queryClient.invalidateQueries({
        queryKey: wikiKeys.pendingCounts(),
      });
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div
      role="treeitem"
      aria-level={1}
      aria-expanded={isOpen}
      className="group/wiki-row relative"
    >
      <div
        className={cn(
          "flex items-center w-full hover:bg-muted/50",
          isRootDocumentSelected &&
            "bg-[var(--nav-active)] text-[var(--nav-foreground-strong)] font-medium",
        )}
      >
        <button
          type="button"
          onClick={() => wikiActions.toggleDirectory(expandKey)}
          aria-label={isOpen ? t("listItem.collapse") : t("listItem.expand")}
          className="flex h-8 w-8 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid={`wiki-list-item-toggle-${wiki.id}`}
        >
          {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <button
          type="button"
          onClick={handleOpenRootDocument}
          className="flex min-w-0 flex-1 items-center gap-1 py-1.5 pr-2 text-left text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid={`wiki-list-item-open-${wiki.id}`}
        >
          {rootIcon ? (
            <span
              aria-hidden="true"
              className="inline-flex h-[14px] w-[14px] items-center justify-center text-[12px] leading-none"
              data-testid={`wiki-list-item-icon-${wiki.id}`}
            >
              {rootIcon}
            </span>
          ) : (
            <LibraryIcon
              size={14}
              className="text-primary group-hover/wiki-row:text-foreground"
            />
          )}
          <span className="truncate">{rootTitle}</span>
        </button>
        <DropdownMenu open={createMenuOpen} onOpenChange={setCreateMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t("listItem.createMenuLabel", { name: rootTitle })}
              title={t("listItem.createMenuLabel", { name: rootTitle })}
              data-testid={`wiki-list-item-create-${wiki.id}`}
              disabled={isCreatingFile}
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded text-muted-foreground group-hover/wiki-row:text-foreground hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
                createMenuOpen
                  ? "opacity-100"
                  : "opacity-0 group-hover/wiki-row:opacity-100 focus-visible:opacity-100",
              )}
            >
              <Plus size={14} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem
              data-testid={`wiki-list-item-create-page-${wiki.id}`}
              onSelect={handleCreatePage}
            >
              <Plus size={14} className="mr-2" />
              {t("listItem.newPage")}
            </DropdownMenuItem>
            <DropdownMenuItem
              data-testid={`wiki-list-item-upload-${wiki.id}`}
              onSelect={handleOpenUploadDialog}
            >
              <Upload size={14} className="mr-2" />
              {t("listItem.uploadFile")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t("listItem.actionsLabel", { name: rootTitle })}
              data-testid={`wiki-list-item-kebab-${wiki.id}`}
              className={cn(
                "mr-2 flex h-6 w-6 items-center justify-center rounded text-muted-foreground group-hover/wiki-row:text-foreground hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                // Hidden until row (or the menu itself) is active, so the
                // sidebar stays uncluttered in the resting state.
                menuOpen
                  ? "opacity-100"
                  : "opacity-0 group-hover/wiki-row:opacity-100 focus-visible:opacity-100",
              )}
            >
              <MoreHorizontal size={14} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem
              data-testid={`wiki-list-item-settings-${wiki.id}`}
              onSelect={() => setShowSettings(true)}
            >
              <Settings size={14} className="mr-2" />
              {t("listItem.settings")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              data-testid={`wiki-list-item-archive-${wiki.id}`}
              className="text-destructive focus:text-destructive"
              onSelect={() => setShowArchiveConfirm(true)}
            >
              <Archive size={14} className="mr-2" />
              {t("listItem.archive")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {isOpen && (
        <div role="group">
          {visibleTree.map((node) => (
            <WikiTreeNode
              key={node.path}
              node={node}
              wikiId={wiki.id}
              wikiSlug={wiki.slug}
              depth={1}
              onCreatePage={handleCreateChildPage}
            />
          ))}
        </div>
      )}
      <WikiSettingsDialog
        open={showSettings}
        onOpenChange={setShowSettings}
        wiki={wiki}
      />
      <Dialog open={showUploadDialog} onOpenChange={setShowUploadDialog}>
        <DialogContent
          className="sm:max-w-lg"
          data-testid={`wiki-list-item-upload-dialog-${wiki.id}`}
        >
          <DialogHeader>
            <DialogTitle>{t("listItem.uploadFile")}</DialogTitle>
            <DialogDescription>
              {t("listItem.uploadDescription", {
                defaultValue:
                  "Upload files into a pending Wiki proposal, then let AI update related pages marked for automatic updates.",
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Button
                type="button"
                variant="outline"
                className="w-full justify-center"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                data-testid={`wiki-list-item-upload-picker-${wiki.id}`}
              >
                <Upload size={16} className="mr-2" />
                {t("listItem.selectUploadItems", {
                  defaultValue: "Select files or folders",
                })}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                data-testid={`wiki-list-item-upload-file-input-${wiki.id}`}
                onChange={(e) => {
                  handleUploadFilesSelected(e.target.files);
                  e.currentTarget.value = "";
                }}
              />
            </div>
            {selectedUploadPaths.length > 0 && (
              <div
                className="max-h-32 overflow-auto rounded border bg-muted/20 p-2 text-xs text-muted-foreground"
                data-testid={`wiki-list-item-upload-selection-${wiki.id}`}
              >
                {selectedUploadPaths.map((path) => (
                  <div key={path} className="truncate">
                    {path}
                  </div>
                ))}
              </div>
            )}
            {uploadProposalId && (
              <div
                className="rounded border border-primary/20 bg-primary/5 p-3 text-sm text-primary"
                data-testid={`wiki-list-item-upload-ai-status-${wiki.id}`}
              >
                {t("listItem.uploadAiStatus", {
                  defaultValue:
                    "Proposal {{proposalId}} created. Related md9 pages can be updated from their summaries.",
                  proposalId: uploadProposalId,
                })}
              </div>
            )}
            {uploadError && (
              <div
                className="rounded border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive"
                data-testid={`wiki-list-item-upload-error-${wiki.id}`}
              >
                {uploadError}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowUploadDialog(false)}
              disabled={isUploading}
              data-testid={`wiki-list-item-upload-cancel-${wiki.id}`}
            >
              {t("archive.cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => void handleUploadSubmit()}
              disabled={selectedUploadFiles.length === 0 || isUploading}
              data-testid={`wiki-list-item-upload-submit-${wiki.id}`}
            >
              {isUploading
                ? t("listItem.uploading", { defaultValue: "Uploading..." })
                : t("listItem.uploadFile")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={showArchiveConfirm}
        onOpenChange={setShowArchiveConfirm}
      >
        <AlertDialogContent
          data-testid={`wiki-list-item-archive-confirm-${wiki.id}`}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{t("archive.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("archive.description", { name: wiki.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={isArchiving}
              data-testid={`wiki-list-item-archive-cancel-${wiki.id}`}
            >
              {t("archive.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                // Block Radix's synchronous auto-close so the async
                // mutation's pending state has a chance to render.
                e.preventDefault();
                void handleArchiveConfirm();
              }}
              disabled={isArchiving}
              data-testid={`wiki-list-item-archive-confirm-button-${wiki.id}`}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isArchiving ? t("archive.archiving") : t("archive.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

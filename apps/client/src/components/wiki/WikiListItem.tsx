import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  Archive,
  ChevronDown,
  ChevronRight,
  Library as LibraryIcon,
  MoreHorizontal,
  Settings,
} from "lucide-react";
import { useWikiTree } from "@/hooks/useWikiTree";
import {
  useExpandedDirectories,
  useSelectedWikiId,
  wikiActions,
} from "@/stores/useWikiStore";
import { buildTree } from "@/lib/wiki-tree";
import { WikiTreeNode } from "./WikiTreeNode";
import { WikiSettingsDialog } from "./WikiSettingsDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
  const expanded = useExpandedDirectories();
  const expandKey = `wiki:${wiki.id}`;
  const isOpen = expanded.has(expandKey);

  const { data: entries } = useWikiTree(isOpen ? wiki.id : null);
  const tree = useMemo(() => (entries ? buildTree(entries) : []), [entries]);

  const [showSettings, setShowSettings] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const archiveWiki = useArchiveWiki();
  const isArchiving = archiveWiki.isPending;

  const navigate = useNavigate();
  const selectedWikiId = useSelectedWikiId();

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

  return (
    <div
      role="treeitem"
      aria-level={1}
      aria-expanded={isOpen}
      className="group/wiki-row relative"
    >
      <div className="flex items-center w-full hover:bg-accent">
        <button
          type="button"
          onClick={() => wikiActions.toggleDirectory(expandKey)}
          className="flex items-center gap-1 px-3 py-1.5 text-sm flex-1 text-left font-medium min-w-0"
          data-testid={`wiki-list-item-toggle-${wiki.id}`}
        >
          {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {wiki.icon ? (
            <span
              aria-hidden="true"
              className="inline-flex h-[14px] w-[14px] items-center justify-center text-[12px] leading-none"
              data-testid={`wiki-list-item-icon-${wiki.id}`}
            >
              {wiki.icon}
            </span>
          ) : (
            <LibraryIcon size={14} className="text-primary" />
          )}
          <span className="truncate">{wiki.name}</span>
        </button>
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t("listItem.actionsLabel", { name: wiki.name })}
              data-testid={`wiki-list-item-kebab-${wiki.id}`}
              className={cn(
                "mr-2 flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
          {tree.map((node) => (
            <WikiTreeNode
              key={node.path}
              node={node}
              wikiSlug={wiki.slug}
              depth={1}
            />
          ))}
        </div>
      )}
      <WikiSettingsDialog
        open={showSettings}
        onOpenChange={setShowSettings}
        wiki={wiki}
      />
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

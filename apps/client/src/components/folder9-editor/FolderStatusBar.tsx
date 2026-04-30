import { useTranslation } from "react-i18next";

interface FolderStatusBarProps {
  /**
   * ISO timestamp of the last successful save, or `null` before any
   * save has occurred (or when the data layer doesn't expose commit
   * metadata — the generic shell currently passes `null`). Formatted
   * as a local time string when present.
   */
  lastSavedAt: string | null;
  isDirty: boolean;
  isSaving: boolean;
  /**
   * Caller-controlled guard for the Save button (e.g. permission check).
   * Even if the page is dirty, we don't want to let the user mash Save
   * when they don't have write permission.
   */
  canSave: boolean;
  onSave: () => void;
}

/**
 * Thin horizontal bar between the editor body and any header/banner.
 *
 * Source-agnostic counterpart of `WikiStatusBar` — same visuals, same
 * i18n keys, but lives inside the folder9-editor package so the shell
 * never reaches across to wiki-specific components.
 *
 * Re-uses the existing `wiki:status.*` i18n strings for now; once the
 * shell hosts more callers (routines, ahand) we can either copy the
 * keys into a shared namespace or split them. The keys are
 * source-agnostic in spirit (just "Save" / "Saving" / "Synced" /
 * "Unsaved changes") so a copy isn't needed yet.
 */
export function FolderStatusBar({
  lastSavedAt,
  isDirty,
  isSaving,
  canSave,
  onSave,
}: FolderStatusBarProps) {
  const { t } = useTranslation("wiki");
  const disabled = !canSave || isSaving || !isDirty;

  return (
    <div className="flex items-center justify-between px-12 py-2 border-b border-border text-xs text-muted-foreground">
      <div className="flex items-center gap-2">
        {isDirty ? (
          <span
            data-testid="folder9-folder-status-unsaved"
            className="text-orange-500"
          >
            ● {t("status.unsaved")}
          </span>
        ) : (
          <span
            data-testid="folder9-folder-status-synced"
            className="text-green-500"
          >
            ● {t("status.synced")}
          </span>
        )}
        {lastSavedAt && (
          <span data-testid="folder9-folder-status-last-saved">
            {t("status.lastSaved", {
              time: new Date(lastSavedAt).toLocaleTimeString(),
            })}
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={onSave}
        disabled={disabled}
        className="px-3 py-1 rounded bg-primary text-primary-foreground disabled:opacity-50 text-xs"
      >
        {isSaving ? t("status.saving") : t("status.save")}
      </button>
    </div>
  );
}

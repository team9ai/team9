import { useTranslation } from "react-i18next";

interface WikiStatusBarProps {
  /**
   * ISO timestamp of the last successful save, or `null` before any save
   * has occurred. Formatted as a local time string so the user can glance
   * and know roughly when they last hit Save.
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
 * Thin horizontal bar between the page header and the editor body.
 *
 * Left side: sync status (orange "Unsaved changes" vs green "Synced") plus
 * the last-saved timestamp when available. Right side: the Save button,
 * which is disabled unless the page is dirty AND the caller says saving is
 * allowed AND we're not already mid-flight.
 *
 * Task 17 only wires the visuals; the `onSave` handler is connected in
 * Task 19 when the commit mutation lands.
 */
export function WikiStatusBar({
  lastSavedAt,
  isDirty,
  isSaving,
  canSave,
  onSave,
}: WikiStatusBarProps) {
  const { t } = useTranslation("wiki");
  const disabled = !canSave || isSaving || !isDirty;

  return (
    <div className="flex items-center justify-between px-12 py-2 border-b border-border text-xs text-muted-foreground">
      <div className="flex items-center gap-2">
        {isDirty ? (
          <span data-testid="wiki-status-unsaved" className="text-orange-500">
            ● {t("status.unsaved")}
          </span>
        ) : (
          <span data-testid="wiki-status-synced" className="text-green-500">
            ● {t("status.synced")}
          </span>
        )}
        {lastSavedAt && (
          <span data-testid="wiki-status-last-saved">
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

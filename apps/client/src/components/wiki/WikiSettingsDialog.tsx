import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { IconPickerPopover } from "./IconPickerPopover";
import { useArchiveWiki, useUpdateWiki } from "@/hooks/useWikis";
import { getHttpErrorMessage, getHttpErrorStatus } from "@/lib/http-error";
import i18n from "@/i18n";
import type {
  WikiApprovalMode,
  WikiDto,
  WikiPermissionLevel,
} from "@/types/wiki";

export interface WikiSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wiki: WikiDto | null;
}

// Keep in lock-step with the gateway `UpdateWikiDto` regex: the slug must
// START with `[a-z0-9]` (no leading dash). The client used to accept a
// leading dash and round-trip to a 400 from the server; we reject it here
// instead so the user gets an inline error.
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
// Server enforces `@Length(1, 100)` on slug.
const SLUG_MAX_LENGTH = 100;

const PERMISSION_LEVELS: WikiPermissionLevel[] = ["read", "propose", "write"];

function permissionLabel(
  level: WikiPermissionLevel,
  t: (key: string) => string,
): string {
  switch (level) {
    case "read":
      return t("settings.permissionRead");
    case "propose":
      return t("settings.permissionPropose");
    case "write":
      return t("settings.permissionWrite");
  }
}

/**
 * Error helpers use the shared `i18n.t` accessor (rather than the hook's
 * bound `t`) so they can stay plain functions outside the component
 * closure — the wiki namespace is eagerly registered in `@/i18n`, so `t`
 * is safe to call at module scope.
 */
function updateErrorMessage(error: unknown): string {
  const status = getHttpErrorStatus(error);
  if (status === 409) {
    return i18n.t("wiki:settings.errors.slugTaken");
  }
  if (status === 403) {
    return i18n.t("wiki:settings.errors.updateForbidden");
  }
  const serverMsg = getHttpErrorMessage(error);
  if (serverMsg) {
    return i18n.t("wiki:settings.errors.updateFailedWithMessage", {
      message: serverMsg,
    });
  }
  return i18n.t("wiki:settings.errors.updateFailed");
}

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
 * Settings dialog for a single Wiki. Holds a local copy of the editable
 * fields so every keystroke doesn't fire a mutation — a single Save click
 * commits the batch, and only diffed fields are sent to the server.
 *
 * Archive lives in a separate danger-zone `AlertDialog` so an accidental
 * click can't end in a wiki disappearing. On confirm the parent dialog
 * closes and we push the user back to `/wiki` (no wiki selected), since
 * the current slug is about to vanish from the sidebar list.
 *
 * `icon` is seeded from the wiki's persisted value and flows through the
 * PATCH payload when the user changes it. The dialog normalises to an
 * empty string both locally and on the wire so "clearing" is expressible
 * (the gateway's `@Length(0, 8)` accepts empty string).
 */
export function WikiSettingsDialog({
  open,
  onOpenChange,
  wiki,
}: WikiSettingsDialogProps) {
  const { t } = useTranslation("wiki");
  const navigate = useNavigate();
  const updateWiki = useUpdateWiki(wiki?.id ?? "");
  const archiveWiki = useArchiveWiki();

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [icon, setIcon] = useState<string | undefined>(undefined);
  const [approvalMode, setApprovalMode] = useState<WikiApprovalMode>("auto");
  const [humanPermission, setHumanPermission] =
    useState<WikiPermissionLevel>("write");
  const [agentPermission, setAgentPermission] =
    useState<WikiPermissionLevel>("read");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);

  // Re-seed the form whenever the dialog opens (or flips to a different
  // wiki mid-session) so stale input from a previous cancelled edit never
  // leaks into the current one.
  useEffect(() => {
    if (open && wiki) {
      setName(wiki.name);
      setSlug(wiki.slug);
      // Seed icon from the persisted wiki value. `null` on the server maps
      // to `undefined` locally so the picker's "no selection" state kicks in.
      setIcon(wiki.icon ?? undefined);
      setApprovalMode(wiki.approvalMode);
      setHumanPermission(wiki.humanPermission);
      setAgentPermission(wiki.agentPermission);
      setValidationError(null);
      setServerError(null);
      setShowArchiveConfirm(false);
    }
  }, [open, wiki]);

  if (!wiki) return null;

  const isSaving = updateWiki.isPending;
  const isArchiving = archiveWiki.isPending;

  const handleSave = async () => {
    if (isSaving) return;

    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      setValidationError(t("settings.errors.nameRequired"));
      return;
    }
    const trimmedSlug = slug.trim();
    if (trimmedSlug.length === 0) {
      setValidationError(t("settings.errors.slugRequired"));
      return;
    }
    if (trimmedSlug.length > SLUG_MAX_LENGTH) {
      setValidationError(
        t("settings.errors.slugTooLong", { max: SLUG_MAX_LENGTH }),
      );
      return;
    }
    if (!SLUG_PATTERN.test(trimmedSlug)) {
      setValidationError(t("settings.errors.slugPattern"));
      return;
    }

    setValidationError(null);
    setServerError(null);

    // Diff against the server's current copy so we only PATCH what moved.
    // (The gateway treats the DTO fields as optional; sending unchanged
    // values wouldn't break anything, but it would produce a noisier audit
    // trail.)
    const patch: Parameters<typeof updateWiki.mutateAsync>[0] = {};
    if (trimmedName !== wiki.name) patch.name = trimmedName;
    if (trimmedSlug !== wiki.slug) patch.slug = trimmedSlug;
    // Normalise both sides to a plain string so `null` (server) and
    // `undefined` (picker cleared) compare equal — the server stores them
    // identically, so leaving this field out of the diff when the user
    // hasn't touched it keeps the PATCH body minimal.
    const currentIcon = wiki.icon ?? "";
    const nextIcon = icon ?? "";
    if (nextIcon !== currentIcon) patch.icon = nextIcon;
    if (approvalMode !== wiki.approvalMode) patch.approvalMode = approvalMode;
    if (humanPermission !== wiki.humanPermission) {
      patch.humanPermission = humanPermission;
    }
    if (agentPermission !== wiki.agentPermission) {
      patch.agentPermission = agentPermission;
    }

    if (Object.keys(patch).length === 0) {
      // Nothing to save — just close the dialog quietly.
      onOpenChange(false);
      return;
    }

    try {
      await updateWiki.mutateAsync(patch);
      onOpenChange(false);
    } catch (error) {
      const message = updateErrorMessage(error);
      setServerError(message);
      window.alert(message);
    }
  };

  const handleFormSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void handleSave();
  };

  // Second invocations while a first is pending are blocked by the
  // AlertDialogAction's `disabled` attribute — the only entry point to
  // this handler.
  const handleArchiveConfirm = async () => {
    try {
      await archiveWiki.mutateAsync(wiki.id);
      setShowArchiveConfirm(false);
      onOpenChange(false);
      navigate({ to: "/wiki" });
    } catch (error) {
      const message = archiveErrorMessage(error);
      setShowArchiveConfirm(false);
      setServerError(message);
      window.alert(message);
    }
  };

  const disabled = isSaving || isArchiving;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="sm:max-w-lg"
          data-testid="wiki-settings-dialog"
        >
          <DialogHeader>
            <DialogTitle>{t("settings.title")}</DialogTitle>
            <DialogDescription>{t("settings.description")}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleFormSubmit} className="space-y-5">
            {/* General ------------------------------------------------- */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">
                {t("settings.generalHeading")}
              </h3>
              <div className="flex items-end gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="wiki-settings-icon">
                    {t("settings.iconLabel")}
                  </Label>
                  <div id="wiki-settings-icon">
                    <IconPickerPopover
                      value={icon}
                      onChange={(next) => setIcon(next)}
                      disabled={disabled}
                    />
                  </div>
                </div>
                <div className="flex-1 space-y-1.5">
                  <Label htmlFor="wiki-settings-name">
                    {t("settings.nameLabel")}{" "}
                    <span className="text-destructive">
                      {t("common.required")}
                    </span>
                  </Label>
                  <Input
                    id="wiki-settings-name"
                    data-testid="wiki-settings-name-input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={disabled}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wiki-settings-slug">
                  {t("settings.slugLabel")}{" "}
                  <span className="text-destructive">
                    {t("common.required")}
                  </span>
                </Label>
                <Input
                  id="wiki-settings-slug"
                  data-testid="wiki-settings-slug-input"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  disabled={disabled}
                />
                <p className="text-xs text-muted-foreground">
                  {t("settings.slugHelp")}
                </p>
              </div>
            </section>

            {/* Approval mode ------------------------------------------ */}
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">
                {t("settings.approvalHeading")}
              </h3>
              <fieldset
                className="space-y-2"
                data-testid="wiki-settings-approval-mode"
                disabled={disabled}
              >
                <legend className="sr-only">
                  {t("settings.approvalLegend")}
                </legend>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="radio"
                    name="wiki-approval-mode"
                    value="auto"
                    data-testid="wiki-settings-approval-auto"
                    checked={approvalMode === "auto"}
                    onChange={() => setApprovalMode("auto")}
                    className="mt-1"
                  />
                  <span>
                    <span className="font-medium">
                      {t("settings.approvalAutoLabel")}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {t("settings.approvalAutoDescription")}
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="radio"
                    name="wiki-approval-mode"
                    value="review"
                    data-testid="wiki-settings-approval-review"
                    checked={approvalMode === "review"}
                    onChange={() => setApprovalMode("review")}
                    className="mt-1"
                  />
                  <span>
                    <span className="font-medium">
                      {t("settings.approvalReviewLabel")}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {t("settings.approvalReviewDescription")}
                    </span>
                  </span>
                </label>
              </fieldset>
            </section>

            {/* Permissions -------------------------------------------- */}
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">
                {t("settings.permissionsHeading")}
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="wiki-settings-human">
                    {t("settings.humanLabel")}
                  </Label>
                  <Select
                    value={humanPermission}
                    onValueChange={(v) =>
                      setHumanPermission(v as WikiPermissionLevel)
                    }
                    disabled={disabled}
                  >
                    <SelectTrigger
                      id="wiki-settings-human"
                      data-testid="wiki-settings-human-trigger"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PERMISSION_LEVELS.map((level) => (
                        <SelectItem
                          key={level}
                          value={level}
                          data-testid={`wiki-settings-human-${level}`}
                        >
                          {permissionLabel(level, t)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wiki-settings-agent">
                    {t("settings.agentLabel")}
                  </Label>
                  <Select
                    value={agentPermission}
                    onValueChange={(v) =>
                      setAgentPermission(v as WikiPermissionLevel)
                    }
                    disabled={disabled}
                  >
                    <SelectTrigger
                      id="wiki-settings-agent"
                      data-testid="wiki-settings-agent-trigger"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PERMISSION_LEVELS.map((level) => (
                        <SelectItem
                          key={level}
                          value={level}
                          data-testid={`wiki-settings-agent-${level}`}
                        >
                          {permissionLabel(level, t)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </section>

            {validationError && (
              <p
                data-testid="wiki-settings-validation-error"
                className="text-sm text-destructive"
              >
                {validationError}
              </p>
            )}
            {serverError && (
              <p
                data-testid="wiki-settings-server-error"
                className="text-sm text-destructive"
              >
                {serverError}
              </p>
            )}

            {/* Danger zone -------------------------------------------- */}
            <section className="space-y-2 rounded-md border border-destructive/30 p-3">
              <h3 className="text-sm font-semibold text-destructive">
                {t("settings.dangerZoneHeading")}
              </h3>
              <p className="text-xs text-muted-foreground">
                {t("settings.dangerZoneDescription")}
              </p>
              <Button
                type="button"
                variant="destructive"
                onClick={() => setShowArchiveConfirm(true)}
                disabled={disabled}
                data-testid="wiki-settings-archive-button"
              >
                {t("settings.archiveButton")}
              </Button>
            </section>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={disabled}
                data-testid="wiki-settings-cancel"
              >
                {t("settings.cancel")}
              </Button>
              <Button
                type="submit"
                disabled={disabled}
                data-testid="wiki-settings-save"
              >
                {isSaving ? t("settings.saving") : t("settings.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={showArchiveConfirm}
        onOpenChange={setShowArchiveConfirm}
      >
        <AlertDialogContent data-testid="wiki-settings-archive-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("archive.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("archive.description", { name: wiki.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={isArchiving}
              data-testid="wiki-settings-archive-cancel"
            >
              {t("archive.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                // Prevent Radix from auto-closing the dialog synchronously
                // — we want the async mutation to resolve first so the user
                // sees the "in-flight" state.
                e.preventDefault();
                void handleArchiveConfirm();
              }}
              disabled={isArchiving}
              data-testid="wiki-settings-archive-confirm-button"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isArchiving ? t("archive.archiving") : t("archive.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
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

function permissionLabel(level: WikiPermissionLevel): string {
  switch (level) {
    case "read":
      return "Read";
    case "propose":
      return "Propose";
    case "write":
      return "Write";
  }
}

function updateErrorMessage(error: unknown): string {
  const status = getHttpErrorStatus(error);
  if (status === 409) {
    return "A Wiki with that slug already exists. Pick another.";
  }
  if (status === 403) {
    return "You don't have permission to update this Wiki.";
  }
  const serverMsg = getHttpErrorMessage(error);
  if (serverMsg) return `Update failed: ${serverMsg}`;
  return "Update failed. Please try again.";
}

function archiveErrorMessage(error: unknown): string {
  const status = getHttpErrorStatus(error);
  if (status === 403) {
    return "You don't have permission to archive this Wiki.";
  }
  const serverMsg = getHttpErrorMessage(error);
  if (serverMsg) return `Archive failed: ${serverMsg}`;
  return "Archive failed. Please try again.";
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
 * `icon` is tracked in local state but is not yet part of the gateway's
 * UpdateWikiDto — we still collect it for UI consistency with the Create
 * flow and will start sending it the moment the server learns the field.
 */
export function WikiSettingsDialog({
  open,
  onOpenChange,
  wiki,
}: WikiSettingsDialogProps) {
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
      setIcon(undefined);
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
      setValidationError("Name is required.");
      return;
    }
    const trimmedSlug = slug.trim();
    if (trimmedSlug.length === 0) {
      setValidationError("Slug is required.");
      return;
    }
    if (trimmedSlug.length > SLUG_MAX_LENGTH) {
      setValidationError(
        `Slug must be ${SLUG_MAX_LENGTH} characters or fewer.`,
      );
      return;
    }
    if (!SLUG_PATTERN.test(trimmedSlug)) {
      setValidationError(
        "Slug must start with a lowercase letter or number and contain only lowercase letters, numbers, and dashes.",
      );
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
            <DialogTitle>Wiki settings</DialogTitle>
            <DialogDescription>
              Configure how this Wiki is named, who can edit it, and how
              proposed changes are reviewed.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleFormSubmit} className="space-y-5">
            {/* General ------------------------------------------------- */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">General</h3>
              <div className="flex items-end gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="wiki-settings-icon">Icon</Label>
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
                    Name <span className="text-destructive">*</span>
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
                  Slug <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="wiki-settings-slug"
                  data-testid="wiki-settings-slug-input"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  disabled={disabled}
                />
                <p className="text-xs text-muted-foreground">
                  Lowercase letters, numbers, and dashes. Must start with a
                  letter or number.
                </p>
              </div>
            </section>

            {/* Approval mode ------------------------------------------ */}
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Approval mode</h3>
              <fieldset
                className="space-y-2"
                data-testid="wiki-settings-approval-mode"
                disabled={disabled}
              >
                <legend className="sr-only">Approval mode</legend>
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
                    <span className="font-medium">Auto merge</span>
                    <span className="block text-xs text-muted-foreground">
                      Writes publish immediately without review.
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
                    <span className="font-medium">Review required</span>
                    <span className="block text-xs text-muted-foreground">
                      Writes land as proposals a reviewer must approve.
                    </span>
                  </span>
                </label>
              </fieldset>
            </section>

            {/* Permissions -------------------------------------------- */}
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Permissions</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="wiki-settings-human">Human</Label>
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
                          {permissionLabel(level)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wiki-settings-agent">Agent</Label>
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
                          {permissionLabel(level)}
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
                Danger zone
              </h3>
              <p className="text-xs text-muted-foreground">
                Archive hides this Wiki from the sidebar for everyone. The
                content stays on the server and an admin can restore it.
              </p>
              <Button
                type="button"
                variant="destructive"
                onClick={() => setShowArchiveConfirm(true)}
                disabled={disabled}
                data-testid="wiki-settings-archive-button"
              >
                Archive Wiki
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
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={disabled}
                data-testid="wiki-settings-save"
              >
                {isSaving ? "Saving…" : "Save changes"}
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
            <AlertDialogTitle>Archive this Wiki?</AlertDialogTitle>
            <AlertDialogDescription>
              “{wiki.name}” will be hidden from the sidebar for everyone. You
              can ask an admin to restore it later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={isArchiving}
              data-testid="wiki-settings-archive-cancel"
            >
              Cancel
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
              {isArchiving ? "Archiving…" : "Archive"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

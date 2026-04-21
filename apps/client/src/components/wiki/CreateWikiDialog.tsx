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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { IconPickerPopover } from "./IconPickerPopover";
import { useCreateWiki } from "@/hooks/useWikis";
import { getHttpErrorMessage, getHttpErrorStatus } from "@/lib/http-error";

export interface CreateWikiDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Mirrors the gateway's `CreateWikiDto` / `UpdateWikiDto` regex exactly:
// the slug must START with `[a-z0-9]` (no leading dash) and may only contain
// lowercase letters, numbers, and dashes thereafter. Keeping the regex in
// lock-step with the server avoids the client cheerfully accepting a slug
// that the server will reject.
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
// Server enforces `@Length(1, 100)` on slug — cap the client-side length so
// we surface the error inline rather than round-tripping to the gateway.
const SLUG_MAX_LENGTH = 100;

/**
 * Normalize a free-text name into a URL-safe slug. Keeps the algorithm tiny
 * (lower-case → collapse non-alphanumerics to `-` → trim dashes) since the
 * server enforces uniqueness and pattern regardless of what we send.
 *
 * Exported so the matching unit test can pin the derivation rules without
 * duplicating the regex.
 */
export function slugifyWikiName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

/**
 * Surfaces a server error as a short sentence. 409 is the well-known
 * "slug already taken" signal from the gateway; any other status falls
 * through to the backend's own message if present, otherwise a generic
 * line. We deliberately stay close to the `WikiPageEditor` copy so users
 * see consistent failure wording across Wiki actions.
 */
function createErrorMessage(error: unknown): string {
  const status = getHttpErrorStatus(error);
  if (status === 409) {
    return "A Wiki with that slug already exists. Pick another.";
  }
  const serverMsg = getHttpErrorMessage(error);
  if (serverMsg) return `Create failed: ${serverMsg}`;
  return "Create failed. Please try again.";
}

/**
 * Dialog used to create a new Wiki from the sub-sidebar. The slug auto-
 * derives from the name until the user manually edits it, at which point
 * the derivation pauses so their typed slug stays stable.
 *
 * On success we close the dialog ourselves and navigate to the new wiki's
 * root. On error we render an inline banner and also surface a toast-like
 * `window.alert` call (matching `WikiPageEditor`'s existing convention —
 * see the comment there for the rationale).
 */
export function CreateWikiDialog({
  open,
  onOpenChange,
}: CreateWikiDialogProps) {
  const navigate = useNavigate();
  const createWiki = useCreateWiki();

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [icon, setIcon] = useState<string | undefined>(undefined);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  // Reset all form state when the dialog (re-)opens. Matches
  // SubmitForReviewDialog: a previously-cancelled draft shouldn't leak into
  // the next open.
  useEffect(() => {
    if (open) {
      setName("");
      setSlug("");
      setSlugManuallyEdited(false);
      setIcon(undefined);
      setValidationError(null);
      setServerError(null);
    }
  }, [open]);

  const handleNameChange = (value: string) => {
    setName(value);
    if (!slugManuallyEdited) {
      setSlug(slugifyWikiName(value));
    }
    // Clear lingering errors once the user edits after a failure.
    if (validationError) setValidationError(null);
    if (serverError) setServerError(null);
  };

  const handleSlugChange = (value: string) => {
    setSlug(value);
    setSlugManuallyEdited(true);
    if (validationError) setValidationError(null);
    if (serverError) setServerError(null);
  };

  const handleSubmit = async () => {
    if (createWiki.isPending) return;

    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      setValidationError("Name is required.");
      return;
    }

    // Slug may be empty — the server will default it from the name. If the
    // user typed something, it MUST match the gateway's pattern and length.
    const trimmedSlug = slug.trim();
    if (trimmedSlug.length > 0) {
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
    }

    setValidationError(null);
    setServerError(null);

    try {
      // `icon` rides alongside `name` and `slug` when the user picked one;
      // if they didn't, we omit the field so the server's default-null path
      // is exercised rather than sending an explicit empty string (which
      // the DTO accepts via `@Length(0, 8)` but isn't the intent here).
      const trimmedIcon = icon?.trim() ?? "";
      const created = await createWiki.mutateAsync({
        name: trimmedName,
        slug: trimmedSlug.length > 0 ? trimmedSlug : undefined,
        icon: trimmedIcon.length > 0 ? trimmedIcon : undefined,
      });
      onOpenChange(false);
      navigate({ to: "/wiki/$wikiSlug", params: { wikiSlug: created.slug } });
    } catch (error) {
      const message = createErrorMessage(error);
      setServerError(message);
      // Mirror the page-editor convention so screen-reader-only banners
      // aren't the sole surface. When a real toast lands, swap both.
      window.alert(message);
    }
  };

  const handleFormSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void handleSubmit();
  };

  const isSubmitting = createWiki.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="create-wiki-dialog">
        <DialogHeader>
          <DialogTitle>Create Wiki</DialogTitle>
          <DialogDescription>
            Create a new Wiki to collaborate on pages with your team.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleFormSubmit} className="space-y-4">
          <div className="flex items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="create-wiki-icon">Icon</Label>
              <div id="create-wiki-icon">
                <IconPickerPopover
                  value={icon}
                  onChange={(next) => setIcon(next)}
                  disabled={isSubmitting}
                />
              </div>
            </div>
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="create-wiki-name">
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="create-wiki-name"
                data-testid="create-wiki-name-input"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="Team handbook"
                disabled={isSubmitting}
                autoFocus
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="create-wiki-slug">Slug</Label>
            <Input
              id="create-wiki-slug"
              data-testid="create-wiki-slug-input"
              value={slug}
              onChange={(e) => handleSlugChange(e.target.value)}
              placeholder="team-handbook"
              disabled={isSubmitting}
            />
            <p className="text-xs text-muted-foreground">
              Lowercase letters, numbers, and dashes. Must start with a letter
              or number. Auto-derived from the name until you edit it.
            </p>
          </div>
          {validationError && (
            <p
              data-testid="create-wiki-validation-error"
              className="text-sm text-destructive"
            >
              {validationError}
            </p>
          )}
          {serverError && (
            <p
              data-testid="create-wiki-server-error"
              className="text-sm text-destructive"
            >
              {serverError}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
              data-testid="create-wiki-cancel"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              data-testid="create-wiki-submit"
            >
              {isSubmitting ? "Creating…" : "Create Wiki"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

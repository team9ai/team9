import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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

export interface SubmitForReviewInput {
  title: string;
  description?: string;
}

export interface SubmitForReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Fired once the user clicks Submit with a non-empty (trimmed) title.
   * Parent is responsible for closing the dialog once the request settles.
   */
  onSubmit: (input: SubmitForReviewInput) => void;
  /**
   * True while the parent's commit mutation is in-flight. Disables the
   * submit button and keeps the inputs stable so the user can't mutate the
   * payload mid-flight.
   */
  isSubmitting?: boolean;
}

/**
 * Modal used when the Wiki is in "review" mode. Collects a proposal title
 * (required) and an optional description, then hands them to the caller via
 * `onSubmit`. The parent wires those values into the `commit(propose: true)`
 * mutation and closes the dialog itself once the request settles.
 *
 * The dialog resets its internal fields whenever it re-opens so a user who
 * cancelled a previous draft doesn't see stale text.
 */
export function SubmitForReviewDialog({
  open,
  onOpenChange,
  onSubmit,
  isSubmitting = false,
}: SubmitForReviewDialogProps) {
  const { t } = useTranslation("wiki");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  // Reset fields whenever the dialog is (re-)opened so a prior draft doesn't
  // linger from a previous cancelled attempt. Gated on `open` transitioning
  // to true so we don't wipe the user's in-progress text on every render.
  useEffect(() => {
    if (open) {
      setTitle("");
      setDescription("");
    }
  }, [open]);

  const trimmedTitle = title.trim();
  const canSubmit = trimmedTitle.length > 0 && !isSubmitting;

  function handleSubmit() {
    if (!canSubmit) return;
    onSubmit({
      title: trimmedTitle,
      description: description.trim() || undefined,
    });
  }

  function handleFormSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    handleSubmit();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-lg"
        data-testid="submit-for-review-dialog"
      >
        <DialogHeader>
          <DialogTitle>{t("submitReview.title")}</DialogTitle>
          <DialogDescription>{t("submitReview.description")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleFormSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="submit-for-review-title">
              {t("submitReview.titleLabel")}{" "}
              <span className="text-destructive">{t("common.required")}</span>
            </Label>
            <Input
              id="submit-for-review-title"
              data-testid="submit-for-review-title-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("submitReview.titlePlaceholder")}
              disabled={isSubmitting}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="submit-for-review-description">
              {t("submitReview.descriptionLabel")}{" "}
              <span className="text-muted-foreground text-xs">
                {t("common.optional")}
              </span>
            </Label>
            <textarea
              id="submit-for-review-description"
              data-testid="submit-for-review-description-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("submitReview.descriptionPlaceholder")}
              disabled={isSubmitting}
              rows={4}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
              data-testid="submit-for-review-cancel"
            >
              {t("submitReview.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={!canSubmit}
              data-testid="submit-for-review-submit"
            >
              {isSubmitting
                ? t("submitReview.submitting")
                : t("submitReview.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

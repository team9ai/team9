import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { diffLines, type Change } from "diff";
import { ArrowLeft, Check, Loader2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCurrentUser } from "@/hooks/useAuth";
import {
  useApproveProposal,
  useProposalDiff,
  useRejectProposal,
  useWikiProposals,
} from "@/hooks/useWikiProposals";
import i18n from "@/i18n";
import { getHttpErrorStatus } from "@/lib/http-error";
import { resolveClientPermission } from "@/lib/wiki-permission";
import type { ProposalDiffEntry, ProposalDto, WikiDto } from "@/types/wiki";

export interface ProposalDiffViewProps {
  wiki: WikiDto;
  proposalId: string;
}

/**
 * One pre-computed rendering row for the diff body. The `.kind` drives the
 * left gutter marker AND the row background — `context` is neutral, `add`
 * is green-tinted, `del` is red-tinted.
 */
interface DiffLine {
  kind: "context" | "add" | "del";
  text: string;
}

/**
 * Convert a `diff.Change[]` into an ordered list of display rows.
 *
 * `diffLines` returns each hunk as one `Change` with the entire (newline-
 * joined) content; we split it back into lines so the renderer can colour
 * each line individually. Trailing empty strings from splitting "a\n" on
 * "\n" are dropped so we don't render a phantom blank line after every
 * hunk.
 */
export function flattenDiff(changes: Change[]): DiffLine[] {
  const rows: DiffLine[] = [];
  for (const change of changes) {
    const kind: DiffLine["kind"] = change.added
      ? "add"
      : change.removed
        ? "del"
        : "context";
    const parts = change.value.split("\n");
    // A value that ends with `\n` produces a trailing empty element from
    // `.split("\n")`. Drop it so we don't render a blank line per hunk.
    if (parts.length > 0 && parts[parts.length - 1] === "") {
      parts.pop();
    }
    for (const line of parts) {
      rows.push({ kind, text: line });
    }
  }
  return rows;
}

/**
 * File-level rendering for one proposal entry. `added` shows only the
 * new content (every line is an add); `deleted` shows only old; `modified`
 * renders a unified diff via the `diff` package.
 */
export function FileDiff({ entry }: { entry: ProposalDiffEntry }) {
  const { t } = useTranslation("wiki");
  const rows = useMemo<DiffLine[]>(() => {
    if (entry.Status === "added") {
      return entry.NewContent
        ? entry.NewContent.replace(/\n$/, "")
            .split("\n")
            .map((text) => ({ kind: "add", text }))
        : [];
    }
    if (entry.Status === "deleted") {
      return entry.OldContent
        ? entry.OldContent.replace(/\n$/, "")
            .split("\n")
            .map((text) => ({ kind: "del", text }))
        : [];
    }
    return flattenDiff(diffLines(entry.OldContent, entry.NewContent));
  }, [entry]);

  return (
    <section
      className="border border-border rounded-md overflow-hidden bg-background"
      data-testid={`proposal-diff-file-${entry.Path}`}
    >
      <header className="flex items-center gap-2 px-3 py-2 bg-muted/40 border-b border-border text-xs">
        <span className="font-mono font-medium truncate flex-1">
          {entry.Path}
        </span>
        <Badge
          variant="outline"
          className="text-[10px] uppercase tracking-wide"
        >
          {entry.Status}
        </Badge>
      </header>
      <pre className="font-mono text-xs whitespace-pre overflow-x-auto">
        {rows.length === 0 && (
          <span
            className="block px-3 py-2 text-muted-foreground italic"
            data-testid={`proposal-diff-file-empty-${entry.Path}`}
          >
            {t("proposalDiff.fileEmpty")}
          </span>
        )}
        {rows.map((row, idx) => (
          <span
            key={idx}
            className={
              row.kind === "add"
                ? "block px-3 bg-green-50 text-green-800 dark:bg-green-500/10 dark:text-green-300"
                : row.kind === "del"
                  ? "block px-3 bg-red-50 text-red-800 dark:bg-red-500/10 dark:text-red-300"
                  : "block px-3 text-foreground/90"
            }
          >
            <span aria-hidden className="select-none pr-2">
              {row.kind === "add" ? "+" : row.kind === "del" ? "-" : " "}
            </span>
            {row.text || "\u00A0"}
          </span>
        ))}
      </pre>
    </section>
  );
}

function notify(message: string) {
  window.alert(message);
}

function approveErrorMessage(error: unknown): string {
  const status = getHttpErrorStatus(error);
  if (status === 409) {
    return i18n.t("wiki:proposalDiff.errors.approveConflict");
  }
  if (status === 403) {
    return i18n.t("wiki:proposalDiff.errors.approveForbidden");
  }
  return i18n.t("wiki:proposalDiff.errors.approveFailed");
}

function rejectErrorMessage(error: unknown): string {
  const status = getHttpErrorStatus(error);
  if (status === 409) {
    return i18n.t("wiki:proposalDiff.errors.rejectConflict");
  }
  if (status === 403) {
    return i18n.t("wiki:proposalDiff.errors.rejectForbidden");
  }
  return i18n.t("wiki:proposalDiff.errors.rejectFailed");
}

/**
 * Proposal detail view — renders the diff and (for users with `write`
 * permission) the Approve / Reject controls. Rejection opens an inline
 * composer so the reviewer can attach a short reason; approval is a
 * one-click action because folder9 doesn't accept a reason on approve.
 *
 * On success we invalidate the proposals list (via the mutation's own
 * `onSuccess`) and navigate back to `/wiki/:slug/-/review` so the user
 * lands on a freshly-pruned queue.
 */
export function ProposalDiffView({ wiki, proposalId }: ProposalDiffViewProps) {
  const { t } = useTranslation("wiki");
  const navigate = useNavigate();
  const { data: currentUser } = useCurrentUser();
  const perm = resolveClientPermission(wiki, currentUser ?? null);
  const canReview = perm === "write";

  // Look up the proposal metadata from the `pending` list first (the
  // common case on this route). We only render the metadata if found —
  // otherwise the header falls back to the proposal id so the user still
  // has context while the list refetches.
  const { data: proposals } = useWikiProposals(wiki.id);
  const proposal: ProposalDto | undefined = proposals?.find(
    (p) => p.id === proposalId,
  );

  const {
    data: diff,
    isLoading: diffLoading,
    isError: diffError,
  } = useProposalDiff(wiki.id, proposalId);

  const approve = useApproveProposal(wiki.id);
  const reject = useRejectProposal(wiki.id);

  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const goBackToList = () => {
    void navigate({
      to: "/wiki/$wikiSlug/-/review",
      params: { wikiSlug: wiki.slug },
    });
  };

  const handleApprove = async () => {
    // Disable state on the button prevents double-submit — no extra
    // guard here. Keeping the handler minimal means the only branch is
    // the mutation's own success/failure, which is what the tests cover.
    try {
      await approve.mutateAsync(proposalId);
      goBackToList();
    } catch (error) {
      notify(approveErrorMessage(error));
    }
  };

  const handleReject = async () => {
    const reason = rejectReason.trim();
    try {
      await reject.mutateAsync({
        proposalId,
        reason: reason.length > 0 ? reason : undefined,
      });
      setShowRejectForm(false);
      setRejectReason("");
      goBackToList();
    } catch (error) {
      notify(rejectErrorMessage(error));
    }
  };

  return (
    <div
      className="flex-1 flex flex-col min-h-0"
      data-testid="proposal-diff-view"
    >
      <header className="px-6 pt-6 pb-4 border-b border-border">
        <button
          type="button"
          onClick={goBackToList}
          className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
          data-testid="proposal-diff-back"
        >
          <ArrowLeft size={12} aria-hidden />
          {t("proposalDiff.back")}
        </button>
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <h1
              className="text-lg font-semibold truncate"
              data-testid="proposal-diff-title"
            >
              {proposal?.title ||
                t("proposalDiff.proposalFallbackTitle", { id: proposalId })}
            </h1>
            {proposal?.description ? (
              <p
                className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap"
                data-testid="proposal-diff-description"
              >
                {proposal.description}
              </p>
            ) : null}
            {proposal ? (
              <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <Badge
                  variant="outline"
                  className="text-[10px] uppercase tracking-wide"
                >
                  {proposal.status}
                </Badge>
                <span>
                  {proposal.authorType === "agent"
                    ? t("proposalDiff.authorAgent")
                    : t("proposalDiff.authorUser")}{" "}
                  {proposal.authorId}
                </span>
                <span aria-hidden>·</span>
                <span>{new Date(proposal.createdAt).toLocaleString()}</span>
              </div>
            ) : null}
          </div>

          {canReview && proposal?.status === "pending" && (
            <div
              className="flex items-center gap-2 shrink-0"
              data-testid="proposal-diff-actions"
            >
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setShowRejectForm((open) => !open)}
                disabled={approve.isPending || reject.isPending}
                data-testid="proposal-diff-reject-toggle"
              >
                <X size={14} className="mr-1" aria-hidden />
                {t("proposalDiff.reject")}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => void handleApprove()}
                disabled={approve.isPending || reject.isPending}
                data-testid="proposal-diff-approve"
              >
                {approve.isPending ? (
                  <Loader2
                    size={14}
                    className="mr-1 animate-spin"
                    aria-hidden
                  />
                ) : (
                  <Check size={14} className="mr-1" aria-hidden />
                )}
                {t("proposalDiff.approve")}
              </Button>
            </div>
          )}
        </div>

        {showRejectForm && canReview && (
          <div
            className="mt-3 p-3 rounded border border-border bg-muted/20 space-y-2"
            data-testid="proposal-diff-reject-form"
          >
            <label
              htmlFor="proposal-diff-reject-reason"
              className="block text-xs font-medium"
            >
              {t("proposalDiff.rejectReasonLabel")}
            </label>
            <textarea
              id="proposal-diff-reject-reason"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
              className="w-full resize-y rounded border border-border bg-background px-2 py-1 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder={t("proposalDiff.rejectReasonPlaceholder")}
              data-testid="proposal-diff-reject-reason"
            />
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setShowRejectForm(false);
                  setRejectReason("");
                }}
                disabled={reject.isPending}
                data-testid="proposal-diff-reject-cancel"
              >
                {t("proposalDiff.rejectCancel")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                onClick={() => void handleReject()}
                disabled={reject.isPending || approve.isPending}
                data-testid="proposal-diff-reject-confirm"
              >
                {reject.isPending ? (
                  <Loader2
                    size={14}
                    className="mr-1 animate-spin"
                    aria-hidden
                  />
                ) : null}
                {t("proposalDiff.rejectConfirm")}
              </Button>
            </div>
          </div>
        )}
      </header>

      <div className="flex-1 overflow-auto px-6 py-4 space-y-4">
        {diffLoading && (
          <p
            className="text-xs text-muted-foreground"
            data-testid="proposal-diff-loading"
          >
            {t("proposalDiff.diffLoading")}
          </p>
        )}

        {diffError && (
          <p
            className="text-xs text-destructive"
            role="alert"
            data-testid="proposal-diff-error"
          >
            {t("proposalDiff.diffLoadFailed")}
          </p>
        )}

        {!diffLoading && !diffError && diff && diff.length === 0 && (
          <p
            className="text-xs text-muted-foreground"
            data-testid="proposal-diff-empty"
          >
            {t("proposalDiff.diffEmpty")}
          </p>
        )}

        {diff?.map((entry) => (
          <FileDiff key={entry.Path} entry={entry} />
        ))}
      </div>
    </div>
  );
}

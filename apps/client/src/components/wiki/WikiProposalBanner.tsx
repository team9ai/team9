import { ExternalLink, MessageSquareWarning } from "lucide-react";
import { useTranslation } from "react-i18next";

export interface WikiProposalBannerProps {
  proposalId: string;
  onView: (proposalId: string) => void;
}

/**
 * Amber banner rendered above the editor body when the current page has a
 * pending proposal awaiting review. The `onView` callback navigates to the
 * proposal's review route (wired by the caller — the banner stays route-
 * agnostic so it can be reused in other surfaces later).
 */
export function WikiProposalBanner({
  proposalId,
  onView,
}: WikiProposalBannerProps) {
  const { t } = useTranslation("wiki");
  return (
    <div
      role="status"
      data-testid="wiki-proposal-banner"
      className="mx-12 my-2 px-3 py-2 flex items-center gap-2 text-xs border border-amber-400/60 bg-amber-50 dark:bg-amber-500/10 rounded"
    >
      <MessageSquareWarning
        size={14}
        className="shrink-0 text-amber-600"
        aria-hidden
      />
      <div className="flex-1">{t("proposalBanner.message")}</div>
      <button
        type="button"
        onClick={() => onView(proposalId)}
        data-testid="wiki-proposal-banner-view"
        className="inline-flex items-center gap-1 px-2 py-1 rounded border border-amber-500/60 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-500/20"
      >
        {t("proposalBanner.view")}
        <ExternalLink size={12} aria-hidden />
      </button>
    </div>
  );
}

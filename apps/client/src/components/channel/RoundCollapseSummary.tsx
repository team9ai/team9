import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export interface RoundCollapseSummaryProps {
  /** Step count used to render "N 步" / "N steps" copy */
  stepCount: number;
  /** Fired when the user clicks/activates the summary row */
  onClick: () => void;
}

/**
 * A compact summary row shown in place of a collapsed agent execution round.
 *
 * When agent execution steps are auto-collapsed in DM channels, this component
 * renders a single clickable row like "... Show execution (3 steps)". Clicking
 * the row invokes `onClick` so the parent can expand the full tracking events.
 *
 * The visible copy is translated via react-i18next so the row adapts to the
 * user's selected language. The `aria-label` is intentionally kept in English
 * across all locales for better screen reader compatibility — most screen
 * readers default to English pronunciation and keeping the label in English
 * avoids mixed-language speech artefacts when the UI language changes. This
 * is why `zh/channel.json` keeps `tracking.round.expandAriaLabel_other` in
 * English. The visual style mirrors {@link TrackingEventItem}'s container
 * (emerald-500/15 left border, faint emerald background) so collapsed and
 * expanded states feel like part of the same agent event stack.
 */
export function RoundCollapseSummary({
  stepCount,
  onClick,
}: RoundCollapseSummaryProps) {
  const { t } = useTranslation("channel");

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "ml-2 mr-4 flex items-center gap-1.5 w-[calc(100%-1.5rem)] text-left",
        "border-l-2 border-border bg-muted/30 rounded-r-md",
        "py-1.5 pr-4",
        "text-xs text-muted-foreground",
        "hover:bg-muted/50 hover:text-foreground",
        "transition-colors duration-150 cursor-pointer",
      )}
      style={{ paddingLeft: "13px" }}
      aria-label={t("tracking.round.expandAriaLabel", { count: stepCount })}
    >
      <ChevronRight size={12} className="shrink-0" />
      <span>{t("tracking.round.collapseSummary", { count: stepCount })}</span>
    </button>
  );
}

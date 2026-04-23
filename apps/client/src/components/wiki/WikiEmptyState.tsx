import { Library } from "lucide-react";
import { useTranslation } from "react-i18next";

export interface WikiEmptyStateProps {
  /**
   * Optional override for the subtitle copy. When omitted we fall back to
   * the default onboarding text ("Pick a page from the tree…"). Callers
   * pass a translated string (e.g. the "wiki not found" message from
   * `WikiPageView`) rather than a key so this component stays free of
   * namespace-specific knowledge.
   */
  message?: string;
}

/**
 * Shown when no Wiki is selected (route `/wiki`) or the selected Wiki has no
 * active page path yet. The `+` button referenced in the copy lives in
 * `WikiSubSidebar` — this component itself is presentation-only.
 *
 * Also used as the "not found" state (e.g. the wiki was archived mid-session)
 * by passing an override `message`.
 */
export function WikiEmptyState({ message }: WikiEmptyStateProps = {}) {
  const { t } = useTranslation("wiki");
  return (
    <main className="h-full flex flex-col items-center justify-center text-center gap-3 bg-background">
      <Library size={48} className="text-primary/40" />
      <h2 className="font-semibold text-lg">{t("empty.title")}</h2>
      <p className="text-sm text-muted-foreground max-w-sm">
        {message ?? t("empty.description")}
      </p>
    </main>
  );
}

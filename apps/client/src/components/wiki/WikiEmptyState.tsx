import { Library } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * Shown when no Wiki is selected (route `/wiki`) or the selected Wiki has no
 * active page path yet. The `+` button referenced in the copy lives in
 * `WikiSubSidebar` — this component itself is presentation-only.
 */
export function WikiEmptyState() {
  const { t } = useTranslation("wiki");
  return (
    <main className="h-full flex flex-col items-center justify-center text-center gap-3 bg-background">
      <Library size={48} className="text-primary/40" />
      <h2 className="font-semibold text-lg">{t("empty.title")}</h2>
      <p className="text-sm text-muted-foreground max-w-sm">
        {t("empty.description")}
      </p>
    </main>
  );
}

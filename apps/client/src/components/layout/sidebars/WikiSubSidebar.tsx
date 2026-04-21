import { Library } from "lucide-react";
import { useTranslation } from "react-i18next";

export function WikiSubSidebar() {
  const { t } = useTranslation("navigation");
  return (
    <div className="flex flex-col h-full bg-background">
      <header className="h-14 flex items-center gap-2 px-4 border-b border-border">
        <Library size={18} className="text-primary" />
        <h2 className="font-semibold text-sm">{t("wiki")}</h2>
      </header>
      <div className="p-4 text-sm text-muted-foreground">
        Wiki tree coming soon…
      </div>
    </div>
  );
}

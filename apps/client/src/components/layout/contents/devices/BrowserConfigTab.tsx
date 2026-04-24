import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";

export function BrowserConfigTab() {
  const { t } = useTranslation("ahand");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <p className="text-sm text-muted-foreground">
          {t("devicesTabs.browserDescription")}
        </p>
        <Badge
          variant="outline"
          size="sm"
          className="h-5 shrink-0 rounded-md border-border/60 bg-background/80 px-1.5 text-[10px] font-medium text-muted-foreground"
        >
          {t("comingSoon")}
        </Badge>
      </div>
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        {t("devicesTabs.placeholder")}
      </div>
    </div>
  );
}

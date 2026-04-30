import { useTranslation } from "react-i18next";
import { BrowserBinaryCard } from "./BrowserBinaryCard";
import { RuntimeCard } from "./RuntimeCard";

export function BrowserConfigTab() {
  const { t } = useTranslation("ahand");

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t("devicesTabs.browserDescription")}
      </p>
      <RuntimeCard />
      <BrowserBinaryCard />
    </div>
  );
}

import { useTranslation } from "react-i18next";
import { isTauriApp } from "@/lib/tauri";
import { ThisMacSection } from "@/components/dialog/devices/ThisMacSection";
import { WebCtaCard } from "@/components/dialog/devices/WebCtaCard";

export function OverviewTab() {
  const { t } = useTranslation("ahand");
  const tauri = isTauriApp();

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t("devicesTabs.overviewDescription")}
      </p>
      {tauri ? <ThisMacSection /> : <WebCtaCard />}
    </div>
  );
}

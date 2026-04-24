import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Zap } from "lucide-react";

export function WebCtaCard() {
  const { t } = useTranslation("ahand");

  function openDesktopApp() {
    const start = Date.now();
    window.location.href = "team9://devices";
    setTimeout(() => {
      if (Date.now() - start < 800 && !document.hidden) {
        toast.info(t("noAppInstalledHint"));
      }
    }, 500);
  }

  function getDesktopDownloadUrl(): string {
    const ua = navigator.userAgent;
    if (/Mac/.test(ua)) return "https://team9.ai/download/mac";
    if (/Win/.test(ua)) return "https://team9.ai/download/windows";
    if (/Linux/.test(ua)) return "https://team9.ai/download/linux";
    return "https://team9.ai/download";
  }

  return (
    <div className="rounded-lg border p-4 bg-gradient-to-br from-primary/5 to-primary/10">
      <div className="flex items-start gap-3">
        <Zap size={20} className="text-primary mt-0.5" />
        <div className="flex-1">
          <h3 className="font-semibold">{t("ctaTitle")}</h3>
          <p className="text-sm text-muted-foreground mt-1">{t("ctaBody")}</p>
          <div className="flex gap-2 mt-3">
            <Button onClick={openDesktopApp} size="sm">
              {t("ctaPrimaryAction")}
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={getDesktopDownloadUrl()}>{t("ctaSecondaryAction")}</a>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

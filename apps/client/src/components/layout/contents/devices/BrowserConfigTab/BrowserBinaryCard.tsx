import { useTranslation } from "react-i18next";
import { Check, Chrome, Globe, Puzzle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

type BrowserOption = {
  key: "bundled" | "chrome" | "edge" | "firefox";
  icon: typeof Chrome;
  detected: boolean;
  recommended?: boolean;
};

const BROWSERS: BrowserOption[] = [
  { key: "bundled", icon: Puzzle, detected: true, recommended: true },
  { key: "chrome", icon: Chrome, detected: false },
  { key: "edge", icon: Globe, detected: false },
  { key: "firefox", icon: Globe, detected: false },
];

export function BrowserBinaryCard() {
  const { t } = useTranslation("ahand");
  const selected: BrowserOption["key"] = "bundled";

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">
            {t("browser.binaryTitle")}
          </CardTitle>
          <Badge
            variant="outline"
            size="sm"
            className="h-5 shrink-0 rounded-md border-border/60 bg-background/80 px-1.5 text-[10px] font-medium text-muted-foreground"
          >
            {t("comingSoon")}
          </Badge>
        </div>
        <CardDescription>{t("browser.binaryDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="divide-y">
        {BROWSERS.map(({ key, icon: Icon, detected, recommended }) => {
          const isSelected = key === selected;
          return (
            <button
              key={key}
              type="button"
              disabled
              className={cn(
                "w-full flex items-center gap-3 py-3 first:pt-0 last:pb-0 text-left",
                "disabled:cursor-not-allowed",
                !detected && "opacity-60",
              )}
            >
              <Icon className="h-5 w-5 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">
                    {t(`browser.binary.${key}` as const)}
                  </p>
                  {recommended && (
                    <Badge
                      variant="outline"
                      size="sm"
                      className="h-5 shrink-0 rounded-md border-emerald-200 bg-emerald-50 px-1.5 text-[10px] font-medium text-emerald-700"
                    >
                      {t("browser.recommended")}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {detected ? t("browser.detected") : t("browser.notDetected")}
                </p>
              </div>
              <div
                className={cn(
                  "w-5 h-5 rounded-full border flex items-center justify-center shrink-0",
                  isSelected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-muted-foreground/30",
                )}
                aria-hidden="true"
              >
                {isSelected && <Check className="h-3 w-3" />}
              </div>
            </button>
          );
        })}
      </CardContent>
    </Card>
  );
}

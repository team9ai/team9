import { useTranslation } from "react-i18next";
import { Globe, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { supportedLanguages } from "@/i18n";
import { changeLanguage, useLanguageLoading } from "@/i18n/loadLanguage";
import { cn } from "@/lib/utils";

interface LanguageSwitcherProps {
  variant?: "icon" | "full";
  className?: string;
}

export function LanguageSwitcher({
  variant = "icon",
  className,
}: LanguageSwitcherProps) {
  const { i18n, t } = useTranslation("settings");
  const { isLoading } = useLanguageLoading();

  const currentLanguage = supportedLanguages.find(
    (lang) => lang.code === i18n.language,
  );

  const handleLanguageChange = async (langCode: string) => {
    await changeLanguage(langCode);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size={variant === "icon" ? "icon" : "default"}
          className={cn(
            "gap-2",
            variant === "full" &&
              "w-full justify-start px-4 py-2 text-sm hover:bg-accent",
            className,
          )}
          disabled={isLoading}
        >
          {isLoading ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Globe size={16} />
          )}
          {variant === "full" && (
            <span className="flex-1 text-left">
              {t("language")}: {currentLanguage?.nativeName || i18n.language}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-1" align="start">
        <div className="space-y-1">
          <p className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
            {t("selectLanguage")}
          </p>
          {supportedLanguages.map((lang) => (
            <button
              key={lang.code}
              onClick={() => handleLanguageChange(lang.code)}
              disabled={isLoading}
              className={cn(
                "w-full flex items-center justify-between px-2 py-1.5 text-sm rounded-sm hover:bg-accent disabled:opacity-50 disabled:pointer-events-none",
                i18n.language === lang.code && "bg-accent",
              )}
            >
              <span>{lang.nativeName}</span>
              {i18n.language === lang.code && (
                <span className="text-primary">✓</span>
              )}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

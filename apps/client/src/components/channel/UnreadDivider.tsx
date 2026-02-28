import { useTranslation } from "react-i18next";

export function UnreadDivider() {
  const { t } = useTranslation("channel");

  return (
    <div className="flex items-center gap-2 my-3">
      <div className="flex-1 h-px bg-destructive/50" />
      <span className="text-xs text-destructive font-medium px-2">
        {t("newMessages", { defaultValue: "New" })}
      </span>
      <div className="flex-1 h-px bg-destructive/50" />
    </div>
  );
}

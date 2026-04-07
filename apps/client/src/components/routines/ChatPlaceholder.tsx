import { useTranslation } from "react-i18next";
import { MessageSquare } from "lucide-react";

export function ChatPlaceholder() {
  const { t } = useTranslation("routines");

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
      <MessageSquare size={40} strokeWidth={1.5} className="opacity-50" />
      <p className="text-sm">{t("chat.placeholder")}</p>
    </div>
  );
}

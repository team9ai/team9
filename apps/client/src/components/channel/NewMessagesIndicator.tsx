import { ArrowDown } from "lucide-react";
import { useTranslation } from "react-i18next";

interface NewMessagesIndicatorProps {
  count: number;
  onClick: () => void;
}

export function NewMessagesIndicator({
  count,
  onClick,
}: NewMessagesIndicatorProps) {
  const { t } = useTranslation("channel");

  return (
    <button
      onClick={onClick}
      className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground
                 px-4 py-2 rounded-full shadow-lg text-sm font-medium z-10
                 flex items-center gap-2 hover:bg-primary/90 transition-colors cursor-pointer"
    >
      <span>
        {count}{" "}
        {t("newMessages", {
          defaultValue: count === 1 ? "new message" : "new messages",
        })}
      </span>
      <ArrowDown className="w-4 h-4" />
    </button>
  );
}

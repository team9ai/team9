import { useTranslation } from "react-i18next";
import { MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";

interface CreationSessionRunItemProps {
  isSelected: boolean;
  onClick: () => void;
}

export function CreationSessionRunItem({
  isSelected,
  onClick,
}: CreationSessionRunItemProps) {
  const { t } = useTranslation("routines");

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full text-left px-2 py-1.5 rounded-md transition-colors",
        "border border-yellow-200/60 dark:border-yellow-800/40",
        "bg-yellow-50/60 dark:bg-yellow-900/15",
        isSelected
          ? "ring-1 ring-primary/30 bg-primary/10"
          : "hover:bg-yellow-100/70 dark:hover:bg-yellow-900/25",
      )}
    >
      <div className="flex items-center gap-1.5">
        <MessageSquare
          size={12}
          className="shrink-0 text-yellow-700 dark:text-yellow-400"
        />
        <span
          className={cn(
            "text-xs font-medium",
            isSelected ? "text-primary" : "text-foreground",
          )}
        >
          {t("creation.runLabel", "Routine Creation")}
        </span>
      </div>
    </button>
  );
}

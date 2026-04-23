import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";

export interface StatusBadgeProps {
  status: "pending" | "running" | "completed" | "failed";
}

// Tailwind class tokens per status. Kept as a lookup so the render stays terse.
const STYLE: Record<StatusBadgeProps["status"], string> = {
  pending: "bg-amber-100 text-amber-800",
  running: "bg-blue-100 text-blue-800",
  completed: "bg-emerald-100 text-emerald-800",
  failed: "bg-red-100 text-red-800",
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const { t } = useTranslation("deepResearch");
  const active = status === "pending" || status === "running";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${STYLE[status]}`}
    >
      {active && <Loader2 size={12} className="animate-spin" />}
      {t(`status.${status}`)}
    </span>
  );
}

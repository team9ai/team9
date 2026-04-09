import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface RoundCollapseSummaryProps {
  /** 步骤数量，用于显示 "N 步" */
  stepCount: number;
  /** 点击展开时触发 */
  onClick: () => void;
}

/**
 * A compact summary row shown in place of a collapsed agent execution round.
 *
 * When agent execution steps are auto-collapsed in DM channels, this component
 * renders a single clickable row like "... 查看执行过程（3 步）". Clicking the
 * row invokes `onClick` so the parent can expand the full tracking events.
 *
 * The visual style intentionally mirrors {@link TrackingEventItem}'s container
 * (emerald-500/15 left border, faint emerald background) so collapsed and
 * expanded states feel like part of the same agent event stack.
 */
export function RoundCollapseSummary({
  stepCount,
  onClick,
}: RoundCollapseSummaryProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "ml-4 flex items-center gap-1.5 w-full text-left",
        "border-l-2 border-emerald-500/15 bg-emerald-500/[0.03] rounded-r-md",
        "py-1.5 pr-4",
        "text-xs text-muted-foreground",
        "hover:bg-emerald-500/[0.06] hover:text-foreground",
        "transition-colors duration-150 cursor-pointer",
      )}
      style={{ paddingLeft: "13px" }}
      aria-label={`Expand execution process (${stepCount} steps)`}
    >
      <ChevronRight size={12} className="shrink-0" />
      <span>... 查看执行过程（{stepCount} 步）</span>
    </button>
  );
}

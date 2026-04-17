import { useTranslation } from "react-i18next";
import { useDeepResearchStore } from "@/stores/useDeepResearchStore";
import { ThoughtSummaryCard } from "./event-cards/ThoughtSummaryCard";
import { UnknownEventDebug } from "./UnknownEventDebug";

export interface EventTimelineProps {
  taskId: string;
}

export function EventTimeline({ taskId }: EventTimelineProps) {
  const { t } = useTranslation("deepResearch");
  const state = useDeepResearchStore((s) => s.byTaskId[taskId]);
  if (!state) return null;
  return (
    <div className="flex flex-col gap-2">
      {state.truncatedThoughts > 0 && (
        <div className="text-xs text-zinc-500">
          {t("detail.thoughtsTruncated", { count: state.truncatedThoughts })}
        </div>
      )}
      {state.thoughts.map((th) => (
        <ThoughtSummaryCard key={th.seq} seq={th.seq} text={th.text} />
      ))}
      <UnknownEventDebug
        count={state.unknownCount}
        samples={state.unknownSamples}
      />
    </div>
  );
}

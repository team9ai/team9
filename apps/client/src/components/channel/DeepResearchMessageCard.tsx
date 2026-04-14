import { ChevronRight, Search } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { TaskDetail } from "@/components/deep-research/TaskDetail";
import { getDeepResearchTaskId } from "@/lib/deep-research-message";
import type { Message } from "@/types/im";

export function DeepResearchMessageCard({ message }: { message: Message }) {
  const { t } = useTranslation("deepResearch");
  const taskId = getDeepResearchTaskId(message.metadata);
  const [expanded, setExpanded] = useState(false);

  if (!taskId) return null;

  return (
    <div className="mt-2 w-full">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
      >
        <ChevronRight
          size={14}
          className={`transition-transform ${expanded ? "rotate-90" : ""}`}
        />
        <Search size={13} />
        <span>{t("title")}</span>
      </button>
      {expanded && (
        <div className="mt-2">
          <TaskDetail taskId={taskId} hideHeader />
        </div>
      )}
    </div>
  );
}

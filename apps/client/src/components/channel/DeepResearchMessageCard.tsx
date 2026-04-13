import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { TaskDetail } from "@/components/deep-research/TaskDetail";
import { getDeepResearchTaskId } from "@/lib/deep-research-message";
import type { Message } from "@/types/im";

export function DeepResearchMessageCard({ message }: { message: Message }) {
  const { t } = useTranslation("deepResearch");
  const taskId = getDeepResearchTaskId(message.metadata);

  if (!taskId) return null;

  return (
    <div className="mt-3 w-full overflow-hidden rounded-2xl border border-sky-200/70 bg-sky-50/60">
      <div className="flex items-center gap-2 border-b border-sky-200/70 px-4 py-2.5 text-sm font-medium text-sky-950">
        <Search size={15} className="text-sky-700" />
        <span>{t("title")}</span>
      </div>
      <TaskDetail taskId={taskId} hideHeader />
    </div>
  );
}

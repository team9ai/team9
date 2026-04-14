import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { TaskList } from "@/components/deep-research/TaskList";
import { NewTaskForm } from "@/components/deep-research/NewTaskForm";

export const Route = createFileRoute("/_authenticated/deep-research/")({
  component: DeepResearchIndex,
});

function DeepResearchIndex() {
  const { t } = useTranslation("deepResearch");
  return (
    <div className="flex h-full">
      <aside className="w-80 overflow-y-auto border-r">
        <div className="border-b p-3">
          <h2 className="mb-2 text-sm font-semibold">{t("title")}</h2>
          <NewTaskForm />
        </div>
        <TaskList />
      </aside>
      <main className="flex-1 overflow-y-auto">
        <div className="p-8 text-sm text-zinc-500">{t("history.empty")}</div>
      </main>
    </div>
  );
}

// TODO: Wire up a sidebar entry for Deep Research in a follow-up task.

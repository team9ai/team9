import { createFileRoute, useParams } from "@tanstack/react-router";
import { TaskList } from "@/components/deep-research/TaskList";
import { TaskDetail } from "@/components/deep-research/TaskDetail";

export const Route = createFileRoute("/_authenticated/deep-research/$taskId")({
  component: DeepResearchDetail,
});

function DeepResearchDetail() {
  const { taskId } = useParams({
    from: "/_authenticated/deep-research/$taskId",
  });
  return (
    <div className="flex h-full">
      <aside className="w-80 overflow-y-auto border-r">
        <TaskList activeId={taskId} />
      </aside>
      <main className="flex-1 overflow-y-auto">
        <TaskDetail taskId={taskId} />
      </main>
    </div>
  );
}

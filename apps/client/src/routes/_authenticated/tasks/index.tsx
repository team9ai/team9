import { createFileRoute } from "@tanstack/react-router";
import { TaskList } from "@/components/tasks/TaskList";

export const Route = createFileRoute("/_authenticated/tasks/")({
  component: TasksPage,
});

function TasksPage() {
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-border shrink-0">
        <h1 className="text-lg font-semibold">Tasks</h1>
      </div>
      <div className="flex-1 min-h-0">
        <TaskList />
      </div>
    </div>
  );
}

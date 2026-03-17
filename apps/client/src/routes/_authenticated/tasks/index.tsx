import { createFileRoute } from "@tanstack/react-router";
import { TaskList } from "@/components/tasks/TaskList";

export const Route = createFileRoute("/_authenticated/tasks/")({
  component: TasksPage,
});

function TasksPage() {
  return (
    <div className="h-full overflow-hidden">
      <TaskList />
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { HomeMainContent } from "@/components/layout/contents/HomeMainContent";

export const Route = createFileRoute("/_authenticated/tasks/new-task")({
  component: TaskNewTaskPage,
});

function TaskNewTaskPage() {
  return <HomeMainContent mode="task" />;
}

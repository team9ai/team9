import { createFileRoute } from "@tanstack/react-router";
import { HomeMainContent } from "@/components/layout/contents/HomeMainContent";

export const Route = createFileRoute("/_authenticated/tasks/new-conversation")({
  component: TaskNewConversationPage,
});

function TaskNewConversationPage() {
  return <HomeMainContent />;
}

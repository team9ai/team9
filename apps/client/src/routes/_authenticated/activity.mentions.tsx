import { createFileRoute } from "@tanstack/react-router";
import { ActivityMainContent } from "@/components/layout/contents/ActivityMainContent";

export const Route = createFileRoute("/_authenticated/activity/mentions")({
  component: ActivityMentionsPage,
});

function ActivityMentionsPage() {
  return <ActivityMainContent />;
}

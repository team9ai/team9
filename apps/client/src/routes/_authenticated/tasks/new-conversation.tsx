import { createFileRoute } from "@tanstack/react-router";
import { HomeMainContent } from "@/components/layout/contents/HomeMainContent";

type TaskNewConversationSearch = {
  agentId?: string;
};

export const Route = createFileRoute("/_authenticated/tasks/new-conversation")({
  component: TaskNewConversationPage,
  validateSearch: (
    search: Record<string, unknown>,
  ): TaskNewConversationSearch => ({
    agentId:
      typeof search.agentId === "string" && search.agentId.length > 0
        ? search.agentId
        : undefined,
  }),
});

function TaskNewConversationPage() {
  const { agentId } = Route.useSearch();

  return <HomeMainContent agentId={agentId ?? null} />;
}

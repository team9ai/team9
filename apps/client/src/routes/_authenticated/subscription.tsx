import { createFileRoute } from "@tanstack/react-router";
import { SubscriptionContent } from "@/components/layout/contents/SubscriptionContent";

type SubscriptionSearchParams = {
  workspaceId?: string;
  view?: "plans" | "credits";
};

export const Route = createFileRoute("/_authenticated/subscription")({
  component: SubscriptionRoute,
  validateSearch: (
    search: Record<string, unknown>,
  ): SubscriptionSearchParams => {
    return {
      workspaceId: search.workspaceId as string | undefined,
      view:
        search.view === "credits" || search.view === "plans"
          ? search.view
          : undefined,
    };
  },
});

function SubscriptionRoute() {
  const { workspaceId, view } = Route.useSearch();

  return (
    <SubscriptionContent workspaceIdFromSearch={workspaceId} view={view} />
  );
}

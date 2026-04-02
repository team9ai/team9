import { createFileRoute } from "@tanstack/react-router";
import { SubscriptionContent } from "@/components/layout/contents/SubscriptionContent";

type SubscriptionSearchParams = {
  workspaceId?: string;
  result?: "success" | "cancel";
  view?: "plans" | "credits";
};

export const Route = createFileRoute("/_authenticated/subscription")({
  component: SubscriptionRoute,
  validateSearch: (
    search: Record<string, unknown>,
  ): SubscriptionSearchParams => {
    return {
      workspaceId: search.workspaceId as string | undefined,
      result:
        search.result === "success" || search.result === "cancel"
          ? search.result
          : undefined,
      view:
        search.view === "credits" || search.view === "plans"
          ? search.view
          : undefined,
    };
  },
});

function SubscriptionRoute() {
  const { workspaceId, result, view } = Route.useSearch();

  return (
    <SubscriptionContent
      workspaceIdFromSearch={workspaceId}
      result={result}
      view={view}
    />
  );
}

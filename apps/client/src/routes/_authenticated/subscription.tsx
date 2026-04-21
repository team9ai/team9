import { createFileRoute } from "@tanstack/react-router";
import { SubscriptionContent } from "@/components/layout/contents/SubscriptionContent";
import type { SubscriptionEntrySource } from "@/analytics/posthog/events";

type SubscriptionSearchParams = {
  workspaceId?: string;
  view?: "plans" | "credits";
  source?: SubscriptionEntrySource;
};

const ENTRY_SOURCES: readonly SubscriptionEntrySource[] = [
  "home",
  "onboarding",
  "manage_credits",
] as const;

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
      source: ENTRY_SOURCES.includes(search.source as SubscriptionEntrySource)
        ? (search.source as SubscriptionEntrySource)
        : undefined,
    };
  },
});

function SubscriptionRoute() {
  const { workspaceId, view, source } = Route.useSearch();

  return (
    <SubscriptionContent
      workspaceIdFromSearch={workspaceId}
      view={view}
      entrySource={source}
    />
  );
}

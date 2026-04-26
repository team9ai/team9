import { createFileRoute, Outlet, useParams } from "@tanstack/react-router";
import { HomeMainContent } from "@/components/layout/contents/HomeMainContent";

type ChannelsIndexSearch = {
  agentId?: string;
};

export const Route = createFileRoute("/_authenticated/channels/")({
  component: ChannelsLayout,
  validateSearch: (search: Record<string, unknown>): ChannelsIndexSearch => ({
    agentId:
      typeof search.agentId === "string" && search.agentId.length > 0
        ? search.agentId
        : undefined,
  }),
});

function ChannelsLayout() {
  // Check if we have a channelId param (child route is active).
  // See note in `activity/index.tsx` re: `never` widening from
  // `useParams({ strict: false })`.
  const params = useParams({ strict: false }) as { channelId?: string };
  const hasChannelId = params.channelId;
  const { agentId } = Route.useSearch();

  // If child route is active, render the Outlet (child content)
  // Otherwise, show the channels overview
  if (hasChannelId) {
    return <Outlet />;
  }

  return <HomeMainContent agentId={agentId ?? null} />;
}

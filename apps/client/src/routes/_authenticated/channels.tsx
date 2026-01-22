import { createFileRoute, Outlet, useParams } from "@tanstack/react-router";
import { HomeMainContent } from "@/components/layout/contents/HomeMainContent";

export const Route = createFileRoute("/_authenticated/channels")({
  component: ChannelsLayout,
});

function ChannelsLayout() {
  // Check if we have a channelId param (child route is active)
  const params = useParams({ strict: false });
  const hasChannelId = "channelId" in params && params.channelId;

  // If child route is active, render the Outlet (child content)
  // Otherwise, show the channels overview
  if (hasChannelId) {
    return <Outlet />;
  }

  return <HomeMainContent />;
}

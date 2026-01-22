import { createFileRoute } from "@tanstack/react-router";
import { ChannelView } from "@/components/channel/ChannelView";

export const Route = createFileRoute("/_authenticated/messages/$channelId")({
  component: DirectMessagePage,
});

function DirectMessagePage() {
  const { channelId } = Route.useParams();

  // Direct messages - user is always a member, render the chat view directly
  return <ChannelView channelId={channelId} />;
}

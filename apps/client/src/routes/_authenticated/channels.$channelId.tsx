import { createFileRoute } from "@tanstack/react-router";
import { ChannelView } from "@/components/channel/ChannelView";

export const Route = createFileRoute("/_authenticated/channels/$channelId")({
  component: ChannelPage,
});

function ChannelPage() {
  const { channelId } = Route.useParams();

  return <ChannelView channelId={channelId} />;
}

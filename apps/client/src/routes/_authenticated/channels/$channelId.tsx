import { createFileRoute } from "@tanstack/react-router";
import { ChannelView } from "@/components/channel/ChannelView";
import { PublicChannelPreviewView } from "@/components/channel/PublicChannelPreviewView";
import { useChannelMembership } from "@/hooks/useChannels";

export const Route = createFileRoute("/_authenticated/channels/$channelId")({
  component: ChannelPage,
});

function ChannelPage() {
  const { channelId } = Route.useParams();
  const { isMember, isLoading, channel } = useChannelMembership(channelId);

  // Loading state while checking membership
  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  // If channel is found in publicChannels and user is not a member, show preview
  if (channel && !isMember) {
    return <PublicChannelPreviewView channel={channel} />;
  }

  // User is a member or channel is not public (private/direct), render full view
  return <ChannelView channelId={channelId} />;
}

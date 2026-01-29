import { createFileRoute } from "@tanstack/react-router";
import { ChannelView } from "@/components/channel/ChannelView";
import { useChannelMembership } from "@/hooks/useChannels";

// Search params type for channel routes
export type ChannelSearchParams = {
  // Thread root message ID - opens thread panel when set
  thread?: string;
  // Target message ID - scrolls to and highlights message
  message?: string;
};

export const Route = createFileRoute("/_authenticated/channels/$channelId")({
  component: ChannelPage,
  validateSearch: (search: Record<string, unknown>): ChannelSearchParams => {
    return {
      thread: search.thread as string | undefined,
      message: search.message as string | undefined,
    };
  },
});

function ChannelPage() {
  const { channelId } = Route.useParams();
  const { thread, message } = Route.useSearch();
  const { isMember, isLoading, channel } = useChannelMembership(channelId);

  // Loading state while checking membership
  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  // Render channel view - pass previewChannel for non-members of public channels
  return (
    <ChannelView
      channelId={channelId}
      initialThreadId={thread}
      initialMessageId={message}
      previewChannel={channel && !isMember ? channel : undefined}
    />
  );
}

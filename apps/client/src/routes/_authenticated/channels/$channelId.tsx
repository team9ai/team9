import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ChannelView } from "@/components/channel/ChannelView";
import { useChannelMembership } from "@/hooks/useChannels";

// Search params type for channel routes
export type ChannelSearchParams = {
  // Thread root message ID - opens thread panel when set
  thread?: string;
  // Target message ID - scrolls to and highlights message
  message?: string;
  // Draft text to pre-fill in the message input
  draft?: string;
};

export const Route = createFileRoute("/_authenticated/channels/$channelId")({
  component: ChannelPage,
  validateSearch: (search: Record<string, unknown>): ChannelSearchParams => {
    return {
      thread: search.thread as string | undefined,
      message: search.message as string | undefined,
      draft: search.draft as string | undefined,
    };
  },
});

function ChannelPage() {
  const { channelId } = Route.useParams();
  const { thread, message, draft } = Route.useSearch();
  const { isMember, isLoading, channel } = useChannelMembership(channelId);
  const { t } = useTranslation("channel");

  // Loading state while checking membership
  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{t("loadingChannel")}</p>
      </div>
    );
  }

  // Render channel view - pass previewChannel for non-members of public channels
  return (
    <ChannelView
      channelId={channelId}
      initialThreadId={thread}
      initialMessageId={message}
      initialDraft={draft}
      previewChannel={channel && !isMember ? channel : undefined}
    />
  );
}

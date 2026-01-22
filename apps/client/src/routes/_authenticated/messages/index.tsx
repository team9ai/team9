import { createFileRoute, Outlet, useParams } from "@tanstack/react-router";
import { MessagesMainContent } from "@/components/layout/contents/MessagesMainContent";

export const Route = createFileRoute("/_authenticated/messages/")({
  component: MessagesLayout,
});

function MessagesLayout() {
  // Check if we have a channelId param (child route is active)
  const params = useParams({ strict: false });
  const hasChannelId = "channelId" in params && params.channelId;

  // If child route is active, render the Outlet (child content)
  // Otherwise, show the default "Select a conversation" content
  if (hasChannelId) {
    return <Outlet />;
  }

  return <MessagesMainContent />;
}

import { createFileRoute } from "@tanstack/react-router";
import { MessagesMainContent } from "@/components/layout/contents/MessagesMainContent";

export const Route = createFileRoute("/_authenticated/messages")({
  component: MessagesPage,
});

function MessagesPage() {
  return <MessagesMainContent />;
}

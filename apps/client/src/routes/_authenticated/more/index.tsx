import { createFileRoute } from "@tanstack/react-router";
import { MoreMainContent } from "@/components/layout/contents/MoreMainContent";

export const Route = createFileRoute("/_authenticated/more/")({
  component: MorePage,
});

function MorePage() {
  return <MoreMainContent />;
}

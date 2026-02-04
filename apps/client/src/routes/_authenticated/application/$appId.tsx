import { createFileRoute } from "@tanstack/react-router";
import { ApplicationDetailContent } from "@/components/layout/contents/ApplicationDetailContent";

export const Route = createFileRoute("/_authenticated/application/$appId")({
  component: ApplicationDetailPage,
});

function ApplicationDetailPage() {
  const { appId } = Route.useParams();
  return <ApplicationDetailContent appId={appId} />;
}

import { createFileRoute } from "@tanstack/react-router";
import { AIStaffDetailContent } from "@/components/layout/contents/AIStaffDetailContent";

export const Route = createFileRoute("/_authenticated/ai-staff/$staffId/")({
  component: AIStaffDetailPage,
});

function AIStaffDetailPage() {
  const { staffId } = Route.useParams();
  return <AIStaffDetailContent staffId={staffId} />;
}

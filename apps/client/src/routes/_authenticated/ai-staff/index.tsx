import { createFileRoute } from "@tanstack/react-router";
import { AIStaffMainContent } from "@/components/layout/contents/AIStaffMainContent";

export const Route = createFileRoute("/_authenticated/ai-staff/")({
  component: AIStaffPage,
});

function AIStaffPage() {
  return <AIStaffMainContent />;
}

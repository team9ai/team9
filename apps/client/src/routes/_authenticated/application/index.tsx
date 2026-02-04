import { createFileRoute } from "@tanstack/react-router";
import { ApplicationMainContent } from "@/components/layout/contents/ApplicationMainContent";

export const Route = createFileRoute("/_authenticated/application/")({
  component: ApplicationPage,
});

function ApplicationPage() {
  return <ApplicationMainContent />;
}

import { createFileRoute, Outlet, useParams } from "@tanstack/react-router";
import { ActivityMainContent } from "@/components/layout/contents/ActivityMainContent";

export const Route = createFileRoute("/_authenticated/activity/")({
  component: ActivityLayout,
});

function ActivityLayout() {
  // Check if we have a filter param (child route is active)
  const params = useParams({ strict: false });
  const hasFilter = "filter" in params && params.filter;

  // If child route is active, render the Outlet (child content)
  // Otherwise, show the default activity content
  if (hasFilter) {
    return <Outlet />;
  }

  return <ActivityMainContent />;
}

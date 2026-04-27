import { createFileRoute, Outlet, useParams } from "@tanstack/react-router";
import { ActivityMainContent } from "@/components/layout/contents/ActivityMainContent";

export const Route = createFileRoute("/_authenticated/activity/")({
  component: ActivityLayout,
});

function ActivityLayout() {
  // Check if we have a filter param (child route is active).
  // `useParams({ strict: false })` returns `never` when no route in the
  // tree declares a `filter` param at this level — cast to a permissive
  // shape so the runtime check still compiles.
  const params = useParams({ strict: false }) as { filter?: string };
  const hasFilter = params.filter;

  // If child route is active, render the Outlet (child content)
  // Otherwise, show the default activity content
  if (hasFilter) {
    return <Outlet />;
  }

  return <ActivityMainContent />;
}

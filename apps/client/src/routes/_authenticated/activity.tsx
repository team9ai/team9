import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { ActivityMainContent } from "@/components/layout/contents/ActivityMainContent";

export const Route = createFileRoute("/_authenticated/activity")({
  component: ActivityLayout,
});

function ActivityLayout() {
  const location = useLocation();

  // Check if we're on a sub-route (mentions or threads)
  const isSubRoute =
    location.pathname === "/activity/mentions" ||
    location.pathname === "/activity/threads";

  // If on sub-route, render the Outlet (child content)
  // Otherwise, show the default activity content
  if (isSubRoute) {
    return <Outlet />;
  }

  return <ActivityMainContent />;
}

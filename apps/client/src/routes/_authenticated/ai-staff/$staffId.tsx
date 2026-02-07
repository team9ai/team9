import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/ai-staff/$staffId")({
  component: AIStaffLayout,
});

function AIStaffLayout() {
  return <Outlet />;
}

import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceSettingsContent } from "@/components/layout/contents/WorkspaceSettingsContent";

export const Route = createFileRoute("/_authenticated/more/workspace-settings")(
  {
    component: WorkspaceSettingsPage,
  },
);

function WorkspaceSettingsPage() {
  return <WorkspaceSettingsContent />;
}

import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceFileBrowserContent } from "@/components/layout/contents/WorkspaceFileBrowserContent";

export const Route = createFileRoute(
  "/_authenticated/ai-staff/$staffId/workspace/$workspaceName",
)({
  component: WorkspaceFileBrowserPage,
});

function WorkspaceFileBrowserPage() {
  const { staffId, workspaceName } = Route.useParams();
  return (
    <WorkspaceFileBrowserContent
      staffId={staffId}
      workspaceName={workspaceName}
    />
  );
}

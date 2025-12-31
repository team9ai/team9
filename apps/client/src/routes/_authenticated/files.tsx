import { createFileRoute } from "@tanstack/react-router";
import { FilesMainContent } from "@/components/layout/contents/FilesMainContent";

export const Route = createFileRoute("/_authenticated/files")({
  component: FilesPage,
});

function FilesPage() {
  return <FilesMainContent />;
}

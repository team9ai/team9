import { createFileRoute } from "@tanstack/react-router";
import { LibraryMainContent } from "@/components/layout/contents/LibraryMainContent";

export const Route = createFileRoute("/_authenticated/library/")({
  component: LibraryPage,
});

function LibraryPage() {
  return <LibraryMainContent />;
}

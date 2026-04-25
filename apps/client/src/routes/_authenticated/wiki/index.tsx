import { createFileRoute } from "@tanstack/react-router";
import { WikiMainContent } from "@/components/layout/contents/WikiMainContent";

/**
 * `/wiki` — the no-selection entry point. Nothing is pushed into
 * `useWikiStore`, so `WikiMainContent` falls back to `<WikiEmptyState />`.
 * The sub-sidebar still loads the wiki list via `useWikis()`.
 */
export const Route = createFileRoute("/_authenticated/wiki/")({
  component: WikiIndexPage,
});

function WikiIndexPage() {
  return <WikiMainContent />;
}

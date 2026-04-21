import { useSelectedPagePath, useSelectedWikiId } from "@/stores/useWikiStore";
import { WikiEmptyState } from "@/components/wiki/WikiEmptyState";
import { WikiPageView } from "@/components/wiki/WikiPageView";

/**
 * Main content switchboard for the Wiki section. The actual route (e.g.
 * `/wiki/:slug/:path`) pushes state into `useWikiStore`; this component just
 * reads the selection and renders either the empty state or the page view.
 * Keeping the routing logic in route components and the rendering logic here
 * means `DynamicSubSidebar` / `DynamicMainContent` wiring stays uniform.
 */
export function WikiMainContent() {
  const wikiId = useSelectedWikiId();
  const pagePath = useSelectedPagePath();

  if (!wikiId || !pagePath) {
    return <WikiEmptyState />;
  }

  return <WikiPageView wikiId={wikiId} path={pagePath} />;
}

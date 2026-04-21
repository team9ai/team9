import { useSelectedPagePath, useSelectedWikiId } from "@/stores/useWikiStore";
import { WikiEmptyState } from "@/components/wiki/WikiEmptyState";
import { WikiPageView } from "@/components/wiki/WikiPageView";
import { useWikiWebSocketSync } from "@/hooks/useWikiWebSocketSync";

/**
 * Main content switchboard for the Wiki section. The actual route (e.g.
 * `/wiki/:slug/:path`) pushes state into `useWikiStore`; this component just
 * reads the selection and renders either the empty state or the page view.
 * Keeping the routing logic in route components and the rendering logic here
 * means `DynamicSubSidebar` / `DynamicMainContent` wiring stays uniform.
 *
 * `useWikiWebSocketSync` is mounted here so every `wiki_*` WS event is
 * translated into a React Query invalidation / Zustand store cleanup while
 * the Wiki UI is on screen. This component is the single stable parent for
 * the Wiki section, so the listener set is installed exactly once.
 */
export function WikiMainContent() {
  const wikiId = useSelectedWikiId();
  const pagePath = useSelectedPagePath();
  useWikiWebSocketSync();

  if (!wikiId || !pagePath) {
    return <WikiEmptyState />;
  }

  return <WikiPageView wikiId={wikiId} path={pagePath} />;
}

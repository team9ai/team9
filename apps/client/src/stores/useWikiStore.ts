import { create } from "zustand";
import { devtools } from "zustand/middleware";

/**
 * Wiki UI state.
 *
 *  * `selectedWikiId` — current Wiki in the sub-sidebar. Null before the user
 *    picks one.
 *  * `selectedPagePath` — current page inside the Wiki. Null until the user
 *    clicks a tree entry. Setting a new `selectedWikiId` clears this so the
 *    main pane doesn't render a stale path from the previous Wiki.
 *  * `expandedDirectories` — keyed by the directory's folder9 path. A `Set`
 *    gives O(1) lookup when rendering tree nodes.
 */
interface WikiState {
  selectedWikiId: string | null;
  selectedPagePath: string | null;
  expandedDirectories: Set<string>;

  setSelectedWiki: (wikiId: string | null) => void;
  setSelectedPage: (path: string | null) => void;
  toggleDirectory: (key: string) => void;
  reset: () => void;
}

const initialState = {
  selectedWikiId: null,
  selectedPagePath: null,
  expandedDirectories: new Set<string>(),
};

export const useWikiStore = create<WikiState>()(
  devtools(
    (set) => ({
      ...initialState,

      setSelectedWiki: (selectedWikiId) =>
        set(
          { selectedWikiId, selectedPagePath: null },
          false,
          "setSelectedWiki",
        ),

      setSelectedPage: (selectedPagePath) =>
        set({ selectedPagePath }, false, "setSelectedPage"),

      toggleDirectory: (key) =>
        set(
          (state) => {
            const next = new Set(state.expandedDirectories);
            if (next.has(key)) {
              next.delete(key);
            } else {
              next.add(key);
            }
            return { expandedDirectories: next };
          },
          false,
          "toggleDirectory",
        ),

      reset: () =>
        set(
          {
            selectedWikiId: null,
            selectedPagePath: null,
            expandedDirectories: new Set<string>(),
          },
          false,
          "reset",
        ),
    }),
    { name: "WikiStore" },
  ),
);

// Selector hooks — each returns a specific slice so components don't
// re-render on unrelated store changes.
export const useSelectedWikiId = () =>
  useWikiStore((state) => state.selectedWikiId);

export const useSelectedPagePath = () =>
  useWikiStore((state) => state.selectedPagePath);

export const useExpandedDirectories = () =>
  useWikiStore((state) => state.expandedDirectories);

// Imperative action bundle for use outside React (route loaders,
// WebSocket listeners, etc.). Mirrors the pattern in `useHomeStore.ts`.
export const wikiActions = {
  setSelectedWiki: (id: string | null) =>
    useWikiStore.getState().setSelectedWiki(id),
  setSelectedPage: (path: string | null) =>
    useWikiStore.getState().setSelectedPage(path),
  toggleDirectory: (key: string) =>
    useWikiStore.getState().toggleDirectory(key),
  reset: () => useWikiStore.getState().reset(),
};

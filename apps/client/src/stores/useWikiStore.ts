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
 *  * `submittedProposals` — keyed by `"${wikiId}:${path}"` → proposal id.
 *    Populated when the user submits a page for review (Task 19) so the
 *    editor can show a banner with a "View proposal" link. Cleared by the
 *    WS consumer (Task 23) once the proposal is approved / rejected /
 *    changes-requested.
 */
interface WikiState {
  selectedWikiId: string | null;
  selectedPagePath: string | null;
  expandedDirectories: Set<string>;
  submittedProposals: Record<string, string>;

  setSelectedWiki: (wikiId: string | null) => void;
  setSelectedPage: (path: string | null) => void;
  /**
   * Toggle the expanded state of a directory. Flips: collapsed ↔ expanded.
   * Used for user-driven tree clicks.
   */
  toggleDirectory: (key: string) => void;
  /**
   * Idempotently expand a directory — never collapses. Used for programmatic
   * auto-expand (e.g. deep-linking into `wiki/:slug/api/docs/auth.md` should
   * expand `api` and `api/docs` without surprising the user by toggling them
   * closed if they were already expanded).
   */
  expandDirectory: (key: string) => void;
  /**
   * Set or clear the proposal id associated with a `(wikiId, path)` pair.
   * Pass `null` as `proposalId` to drop the entry (e.g. the server told us
   * the proposal was resolved).
   */
  setSubmittedProposal: (
    wikiId: string,
    path: string,
    proposalId: string | null,
  ) => void;
  reset: () => void;
}

const initialState = {
  selectedWikiId: null,
  selectedPagePath: null,
  expandedDirectories: new Set<string>(),
  submittedProposals: {} as Record<string, string>,
};

/** Build the composite key for `submittedProposals`. */
export function submittedProposalKey(wikiId: string, path: string): string {
  return `${wikiId}:${path}`;
}

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

      expandDirectory: (key) =>
        set(
          (state) => {
            if (state.expandedDirectories.has(key)) {
              // Already expanded — return the existing reference so subscribers
              // don't re-render on a no-op.
              return state;
            }
            const next = new Set(state.expandedDirectories);
            next.add(key);
            return { expandedDirectories: next };
          },
          false,
          "expandDirectory",
        ),

      setSubmittedProposal: (wikiId, path, proposalId) =>
        set(
          (state) => {
            const key = submittedProposalKey(wikiId, path);
            if (proposalId === null) {
              // Clearing an entry that doesn't exist is a no-op — return the
              // same reference so subscribers don't re-render.
              if (!(key in state.submittedProposals)) {
                return state;
              }
              const next = { ...state.submittedProposals };
              delete next[key];
              return { submittedProposals: next };
            }
            if (state.submittedProposals[key] === proposalId) {
              // Same proposal id already recorded — no-op.
              return state;
            }
            return {
              submittedProposals: {
                ...state.submittedProposals,
                [key]: proposalId,
              },
            };
          },
          false,
          "setSubmittedProposal",
        ),

      reset: () =>
        set(
          {
            selectedWikiId: null,
            selectedPagePath: null,
            expandedDirectories: new Set<string>(),
            submittedProposals: {},
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

/**
 * Return the proposal id currently submitted for the given `(wikiId, path)`,
 * or `null` when none has been recorded. Using a key-derived lookup keeps
 * re-renders scoped to the specific page a component cares about.
 */
export const useSubmittedProposal = (wikiId: string, path: string) =>
  useWikiStore(
    (state) =>
      state.submittedProposals[submittedProposalKey(wikiId, path)] ?? null,
  );

// Imperative action bundle for use outside React (route loaders,
// WebSocket listeners, etc.). Mirrors the pattern in `useHomeStore.ts`.
export const wikiActions = {
  setSelectedWiki: (id: string | null) =>
    useWikiStore.getState().setSelectedWiki(id),
  setSelectedPage: (path: string | null) =>
    useWikiStore.getState().setSelectedPage(path),
  toggleDirectory: (key: string) =>
    useWikiStore.getState().toggleDirectory(key),
  expandDirectory: (key: string) =>
    useWikiStore.getState().expandDirectory(key),
  setSubmittedProposal: (
    wikiId: string,
    path: string,
    proposalId: string | null,
  ) => useWikiStore.getState().setSubmittedProposal(wikiId, path, proposalId),
  reset: () => useWikiStore.getState().reset(),
};

export const WIKI_PAGE_EXTENSION = ".md9";
export const DEFAULT_WIKI_INDEX_FILENAME = `index${WIKI_PAGE_EXTENSION}`;
export const DEFAULT_WIKI_INDEX_PATH = DEFAULT_WIKI_INDEX_FILENAME;
export const LEGACY_WIKI_INDEX_FILENAME = "index.md";

export function stripWikiPageExtension(name: string): string {
  return name.replace(/\.md9$/i, "");
}

// Backward-compatible export for stale chunks/imports after the md9 rename.
// Despite the historical name, only `.md9` is hidden by default.
export const stripMarkdownPageExtension = stripWikiPageExtension;

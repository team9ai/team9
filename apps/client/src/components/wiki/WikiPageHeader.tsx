import { Fragment, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { stripWikiPageExtension } from "@/lib/wiki-paths";
import { cn } from "@/lib/utils";
import { IconPickerPopover } from "./IconPickerPopover";

interface WikiPageHeaderProps {
  wikiSlug: string;
  /** Folder9-relative path, e.g. `"api/docs/auth.md9"` or `"index.md9"`. */
  path: string;
  frontmatter: Record<string, unknown>;
  body: string;
  readOnly?: boolean;
  isSavingMetadata?: boolean;
  onFrontmatterChange?: (next: Record<string, unknown>) => void;
}

/**
 * Derive the rendered page title, falling back in the order documented on
 * the Notion-style wiki spec:
 *  1. `frontmatter.title` (explicit user intent wins)
 *  2. First top-level `# Heading` in the body
 *  3. The filename (minus `.md9`) — last resort so we never show an empty
 *     title for pages that haven't been annotated yet.
 */
export function extractTitle(
  path: string,
  frontmatter: Record<string, unknown>,
  body: string,
): string {
  const fmTitle = frontmatter.title;
  if (typeof fmTitle === "string" && fmTitle.trim().length > 0) return fmTitle;

  const h1 = body.match(/^#\s+(.+)$/m);
  if (h1 && h1[1]) return h1[1].trim();

  const base = path.split("/").pop() ?? path;
  return stripWikiPageExtension(base);
}

/**
 * Icon that hangs off the lower edge of the cover band. Emoji strings are
 * rendered directly (Notion-style). Any non-string `frontmatter.icon` falls
 * back to a neutral document glyph.
 */
function iconFor(frontmatter: Record<string, unknown>): string {
  const icon = frontmatter.icon;
  return typeof icon === "string" && icon.length > 0 ? icon : "📄";
}

/**
 * Breadcrumb + title + icon.
 *
 * Breadcrumb: shows the wiki slug as a link back to the wiki root, followed
 * by every parent directory segment. The filename itself is omitted — the
 * title immediately below replaces it, matching Notion's layout.
 */
export function WikiPageHeader({
  wikiSlug,
  path,
  frontmatter,
  body,
  readOnly = true,
  isSavingMetadata = false,
  onFrontmatterChange,
}: WikiPageHeaderProps) {
  const icon = iconFor(frontmatter);
  const title = extractTitle(path, frontmatter, body);
  const canEdit = !readOnly && onFrontmatterChange !== undefined;
  const [draftTitle, setDraftTitle] = useState(title);
  const segments = path ? path.split("/").slice(0, -1) : [];

  useEffect(() => {
    setDraftTitle(title);
  }, [title]);

  const commitTitle = () => {
    if (!canEdit || isSavingMetadata) return;
    const nextTitle = draftTitle.trim();
    const currentTitle =
      typeof frontmatter.title === "string" ? frontmatter.title.trim() : "";
    if (nextTitle === currentTitle || nextTitle.length === 0) {
      if (nextTitle.length === 0) setDraftTitle(title);
      return;
    }
    onFrontmatterChange?.({ ...frontmatter, title: nextTitle });
  };

  const handleIconChange = (nextIcon: string) => {
    if (!canEdit || isSavingMetadata) return;
    onFrontmatterChange?.({ ...frontmatter, icon: nextIcon });
  };

  return (
    <header className="relative px-12 pb-3 pt-8">
      <div data-testid="wiki-page-icon" className="absolute -top-7 left-12">
        {canEdit ? (
          <IconPickerPopover
            value={icon}
            onChange={handleIconChange}
            disabled={isSavingMetadata}
            className="w-14 h-14 text-4xl rounded-lg shadow-lg border-0"
          />
        ) : (
          <div className="w-14 h-14 flex items-center justify-center text-4xl bg-background rounded-lg shadow-lg">
            {icon}
          </div>
        )}
      </div>
      <nav
        aria-label="breadcrumb"
        className="text-xs text-muted-foreground mt-6 mb-2 flex flex-wrap gap-1"
      >
        <Link
          to="/wiki/$wikiSlug"
          params={{ wikiSlug }}
          className="hover:underline"
        >
          {wikiSlug}
        </Link>
        {segments.map((seg, i) => (
          <Fragment key={`${i}-${seg}`}>
            <span aria-hidden="true">/</span>
            <span>{seg}</span>
          </Fragment>
        ))}
      </nav>
      {canEdit ? (
        <input
          aria-label="Page title"
          data-testid="wiki-page-title-input"
          value={draftTitle}
          disabled={isSavingMetadata}
          onChange={(event) => setDraftTitle(event.target.value)}
          onBlur={commitTitle}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
            if (event.key === "Escape") {
              setDraftTitle(title);
              event.currentTarget.blur();
            }
          }}
          className={cn(
            "w-full bg-transparent text-3xl font-bold outline-none",
            "rounded-sm focus-visible:ring-2 focus-visible:ring-ring",
            "disabled:opacity-60",
          )}
        />
      ) : (
        <h1 className="text-3xl font-bold">{title}</h1>
      )}
    </header>
  );
}

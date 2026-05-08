export const DESKTOP_DEEP_LINK_SCHEME =
  import.meta.env.VITE_DESKTOP_DEEP_LINK_SCHEME || "team9";

export function buildDesktopDeepLink(path: string, search?: string): string {
  const normalizedPath = path.replace(/^\/+/, "");
  const normalizedSearch = search
    ? search.startsWith("?")
      ? search
      : `?${search}`
    : "";
  return `${DESKTOP_DEEP_LINK_SCHEME}://${normalizedPath}${normalizedSearch}`;
}

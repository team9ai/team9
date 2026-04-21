/**
 * Placeholder for the real Wiki page view. Task 17 replaces the body with
 * live content rendering (frontmatter + markdown + commit metadata). Kept as
 * a minimal stub so Task 15's routing and main-content wiring compile today.
 *
 * Props match the target shape so the `WikiMainContent` call site doesn't
 * need to change when Task 17 lands.
 */
export interface WikiPageViewProps {
  wikiId: string;
  path: string;
}

export function WikiPageView(_props: WikiPageViewProps) {
  return <div>loading...</div>;
}

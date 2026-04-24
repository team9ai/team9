import { NavigationRail } from "./NavigationRail";

/**
 * Column 2 of the three-column layout. Hosts the same nav items as the
 * collapsed-mode inline rail, but displayed as a dedicated column next to
 * the workspace avatars when the sidebar is expanded.
 */
export function SidebarNavRail() {
  return (
    <>
      <nav className="w-16 h-full bg-nav-sub-bg text-primary-foreground flex flex-col items-center pt-4 space-y-2 overflow-y-auto scrollbar-hide">
        <NavigationRail />
      </nav>
      <div className="w-px h-full bg-border shrink-0" />
    </>
  );
}

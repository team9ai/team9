import { useLocation } from "@tanstack/react-router";
import type { KeyboardEvent, PointerEvent, ReactNode } from "react";
import { HomeSubSidebar } from "./sidebars/HomeSubSidebar";
import { MessagesSubSidebar } from "./sidebars/MessagesSubSidebar";
import { ActivitySubSidebar } from "./sidebars/ActivitySubSidebar";
import { FilesSubSidebar } from "./sidebars/FilesSubSidebar";
import { MoreSubSidebar } from "./sidebars/MoreSubSidebar";
import { WikiSubSidebar } from "./sidebars/WikiSubSidebar";
import {
  SUB_SIDEBAR_WIDTH_MAX,
  SUB_SIDEBAR_WIDTH_MIN,
  appActions,
  useActiveSidebar,
  useSubSidebarWidth,
  type SidebarSection,
} from "@/stores";

type SidebarType = SidebarSection | null;

function getSidebarType(
  pathname: string,
  activeSidebar: SidebarSection,
): SidebarType {
  // For channel routes, use the stored activeSidebar to maintain context
  if (pathname.startsWith("/channels")) {
    return activeSidebar;
  }

  // Match routes to sidebar types
  if (pathname === "/" || pathname.startsWith("/home")) {
    return "home";
  }
  if (pathname.startsWith("/messages")) {
    return "messages";
  }
  if (pathname.startsWith("/activity")) {
    return "activity";
  }
  if (pathname.startsWith("/wiki")) {
    return "wiki";
  }
  if (pathname.startsWith("/files")) {
    return "files";
  }
  if (pathname.startsWith("/more")) {
    return "more";
  }
  return null;
}

export function DynamicSubSidebar() {
  const location = useLocation();
  const activeSidebar = useActiveSidebar();
  const width = useSubSidebarWidth();
  const sidebarType = getSidebarType(location.pathname, activeSidebar);
  let sidebar: ReactNode = null;

  switch (sidebarType) {
    case "home":
      sidebar = <HomeSubSidebar />;
      break;
    case "messages":
      sidebar = <MessagesSubSidebar />;
      break;
    case "activity":
      sidebar = <ActivitySubSidebar />;
      break;
    case "files":
      sidebar = <FilesSubSidebar />;
      break;
    case "wiki":
      sidebar = <WikiSubSidebar />;
      break;
    case "more":
      sidebar = <MoreSubSidebar />;
      break;
    default:
      return null;
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
      appActions.setSubSidebarWidth(startWidth + moveEvent.clientX - startX);
    };

    const handlePointerUp = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step = event.shiftKey ? 40 : 10;
    appActions.setSubSidebarWidth(
      width + (event.key === "ArrowRight" ? step : -step),
    );
  };

  return (
    <aside
      data-testid="dynamic-sub-sidebar"
      className="relative h-full shrink-0 overflow-hidden bg-nav-sub-bg"
      style={{ width }}
    >
      <div className="h-full w-full min-w-0 overflow-hidden [&>aside]:w-full [&>div]:w-full">
        {sidebar}
      </div>
      <div
        role="separator"
        aria-label="Resize sidebar"
        aria-orientation="vertical"
        aria-valuemin={SUB_SIDEBAR_WIDTH_MIN}
        aria-valuemax={SUB_SIDEBAR_WIDTH_MAX}
        aria-valuenow={width}
        tabIndex={0}
        data-testid="sub-sidebar-resize-handle"
        onPointerDown={handlePointerDown}
        onKeyDown={handleKeyDown}
        className="absolute inset-y-0 right-0 w-1 cursor-col-resize bg-transparent outline-none transition-colors hover:bg-border focus-visible:bg-primary/50 active:bg-primary/50"
      />
    </aside>
  );
}

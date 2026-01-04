import { useLocation } from "@tanstack/react-router";
import { HomeSubSidebar } from "./sidebars/HomeSubSidebar";
import { MessagesSubSidebar } from "./sidebars/MessagesSubSidebar";
import { ActivitySubSidebar } from "./sidebars/ActivitySubSidebar";
import { FilesSubSidebar } from "./sidebars/FilesSubSidebar";
import { MoreSubSidebar } from "./sidebars/MoreSubSidebar";
import { useActiveSidebar, type SidebarSection } from "@/stores";

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
  const sidebarType = getSidebarType(location.pathname, activeSidebar);

  switch (sidebarType) {
    case "home":
      return <HomeSubSidebar />;
    case "messages":
      return <MessagesSubSidebar />;
    case "activity":
      return <ActivitySubSidebar />;
    case "files":
      return <FilesSubSidebar />;
    case "more":
      return <MoreSubSidebar />;
    default:
      return null;
  }
}

import { useLocation } from "@tanstack/react-router";
import { HomeSubSidebar } from "./sidebars/HomeSubSidebar";
import { MessagesSubSidebar } from "./sidebars/MessagesSubSidebar";
import { ActivitySubSidebar } from "./sidebars/ActivitySubSidebar";
import { FilesSubSidebar } from "./sidebars/FilesSubSidebar";
import { MoreSubSidebar } from "./sidebars/MoreSubSidebar";

type SidebarType = "home" | "messages" | "activity" | "files" | "more" | null;

function getSidebarType(pathname: string): SidebarType {
  // Match routes to sidebar types
  if (pathname === "/" || pathname.startsWith("/home")) {
    return "home";
  }
  if (pathname.startsWith("/messages") || pathname.startsWith("/channels")) {
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
  const sidebarType = getSidebarType(location.pathname);

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

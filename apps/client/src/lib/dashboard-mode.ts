import {
  HOME_ENTRY_PATH,
  TASK_ENTRY_PATH,
  type HomeDashboardMode,
} from "@/stores";

export function getDashboardModeEntryPath(mode: HomeDashboardMode) {
  return mode === "task" ? TASK_ENTRY_PATH : HOME_ENTRY_PATH;
}

export function isDashboardModeEntryPath(pathname: string) {
  return pathname === HOME_ENTRY_PATH || pathname === TASK_ENTRY_PATH;
}

export function replaceDashboardModeEntryUrl(mode: HomeDashboardMode) {
  if (typeof window === "undefined") return false;

  const currentUrl = new URL(window.location.href);
  if (!isDashboardModeEntryPath(currentUrl.pathname)) return false;

  const nextPath = getDashboardModeEntryPath(mode);
  if (currentUrl.pathname === nextPath && !currentUrl.search) return true;

  window.history.replaceState(window.history.state, "", nextPath);
  return true;
}

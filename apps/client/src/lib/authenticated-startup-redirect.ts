import {
  DEFAULT_SECTION_PATHS,
  isRestorableSectionPath,
  isSidebarSection,
  sanitizeLastVisitedPaths,
} from "@/stores";

export interface AuthenticatedStartupLocation {
  href: string;
  pathname: string;
}

export type AuthenticatedStartupRedirect = {
  to: string;
  search?: Record<string, string>;
} | null;

interface StartupRedirectOptions {
  location: AuthenticatedStartupLocation;
  localStorage?: Storage;
  sessionStorage?: Storage;
}

function getLocalStorage(options?: StartupRedirectOptions) {
  if (options?.localStorage) {
    return options.localStorage;
  }

  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage;
}

function getSessionStorage(options?: StartupRedirectOptions) {
  if (options?.sessionStorage) {
    return options.sessionStorage;
  }

  if (typeof window === "undefined") {
    return null;
  }

  return window.sessionStorage;
}

export function getAuthenticatedStartupRedirect(
  options: StartupRedirectOptions,
): AuthenticatedStartupRedirect {
  const storage = getLocalStorage(options);
  const session = getSessionStorage(options);
  const { location } = options;
  const token = storage?.getItem("auth_token");

  if (!token) {
    return {
      to: "/login",
      search: {
        redirect: location.href,
      },
    };
  }

  if (location.pathname !== "/" || !session) {
    return null;
  }

  if (session.getItem("app_initialized")) {
    return null;
  }

  session.setItem("app_initialized", "true");

  const appStorage = storage?.getItem("app-storage");
  if (!appStorage) {
    return null;
  }

  try {
    const parsed = JSON.parse(appStorage);
    const activeSidebar = isSidebarSection(parsed?.state?.activeSidebar)
      ? parsed.state.activeSidebar
      : "home";
    const lastVisitedPaths = sanitizeLastVisitedPaths(
      parsed?.state?.lastVisitedPaths,
    );

    if (
      parsed?.state?.lastVisitedPaths &&
      JSON.stringify(parsed.state.lastVisitedPaths) !==
        JSON.stringify(lastVisitedPaths)
    ) {
      storage?.setItem(
        "app-storage",
        JSON.stringify({
          ...parsed,
          state: {
            ...parsed.state,
            lastVisitedPaths,
          },
        }),
      );
    }

    const normalizedSidebar =
      activeSidebar as keyof typeof DEFAULT_SECTION_PATHS;
    const lastVisitedPath =
      lastVisitedPaths[normalizedSidebar] ??
      DEFAULT_SECTION_PATHS[normalizedSidebar];

    if (isRestorableSectionPath(lastVisitedPath)) {
      return { to: lastVisitedPath };
    }
  } catch {
    return null;
  }

  return null;
}

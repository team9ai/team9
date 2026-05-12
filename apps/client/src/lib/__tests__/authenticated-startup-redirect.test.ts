import { beforeEach, describe, expect, it } from "vitest";
import { getAuthenticatedStartupRedirect } from "@/lib/authenticated-startup-redirect";

function location(pathname: string) {
  return {
    href: pathname,
    pathname,
  };
}

describe("getAuthenticatedStartupRedirect", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("redirects unauthenticated starts to login without remote bootstrap", () => {
    expect(
      getAuthenticatedStartupRedirect({
        location: location("/channels/channel-1"),
      }),
    ).toEqual({
      to: "/login",
      search: { redirect: "/channels/channel-1" },
    });
  });

  it("restores the last visited section path on the first authenticated root load", () => {
    localStorage.setItem("auth_token", "token-1");
    localStorage.setItem(
      "app-storage",
      JSON.stringify({
        state: {
          activeSidebar: "home",
          lastVisitedPaths: {
            home: "/channels/channel-1",
          },
        },
      }),
    );

    expect(
      getAuthenticatedStartupRedirect({ location: location("/") }),
    ).toEqual({
      to: "/channels/channel-1",
    });
    expect(sessionStorage.getItem("app_initialized")).toBe("true");
  });
});

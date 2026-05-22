import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: unknown) => ({ __config: config }),
  redirect: (options: unknown) => ({ type: "redirect", options }),
}));

import { Route as AuthenticatedIndexRoute } from "@/routes/_authenticated/index";

describe("/_authenticated/ index route", () => {
  it("redirects the signed-in homepage to task new conversation", () => {
    const beforeLoad = (
      AuthenticatedIndexRoute as unknown as {
        __config: { beforeLoad: () => never };
      }
    ).__config.beforeLoad;

    let thrown: unknown;
    try {
      beforeLoad();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toEqual({
      type: "redirect",
      options: { to: "/tasks/new-conversation" },
    });
  });
});

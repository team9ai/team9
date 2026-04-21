import { describe, expect, it } from "vitest";
import {
  isRestorableSectionPath,
  sanitizeLastVisitedPaths,
  useAppStore,
} from "../useAppStore";

describe("useAppStore navigation helpers", () => {
  it("rejects utility routes from last-visited restore", () => {
    expect(isRestorableSectionPath("/profile")).toBe(false);
    expect(isRestorableSectionPath("/search?q=test")).toBe(false);
    expect(isRestorableSectionPath("/")).toBe(false);
    expect(isRestorableSectionPath("/more")).toBe(true);
  });

  it("clears polluted persisted paths while preserving section pages", () => {
    expect(
      sanitizeLastVisitedPaths({
        home: "/profile",
        messages: "/messages/dm-1",
        more: "/search?q=docs",
      }),
    ).toMatchObject({
      home: null,
      messages: "/messages/dm-1",
      more: null,
    });
  });

  it("resets all section paths, including skill detail pages, on workspace entry", () => {
    useAppStore.setState({
      activeSidebar: "skills",
      lastVisitedPaths: {
        home: "/channels/channel-1",
        messages: "/messages/dm-1",
        activity: "/activity/channel-1",
        files: "/files",
        aiStaff: "/ai-staff/staff-1",
        routines: "/routines",
        skills: "/skills/skill-1",
        resources: "/resources",
        wiki: "/wiki",
        application: "/application/app-1",
        more: "/more/members",
      },
    });

    useAppStore.getState().resetNavigationForWorkspaceEntry();

    const state = useAppStore.getState();
    expect(state.activeSidebar).toBe("home");
    expect(state.lastVisitedPaths).toMatchObject({
      home: null,
      messages: null,
      activity: null,
      files: null,
      aiStaff: null,
      routines: null,
      skills: null,
      resources: null,
      wiki: null,
      application: null,
      more: null,
    });
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import {
  SUB_SIDEBAR_WIDTH_DEFAULT,
  SUB_SIDEBAR_WIDTH_MAX,
  SUB_SIDEBAR_WIDTH_MIN,
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

  it("defaults the secondary sidebar width to a wider size", () => {
    useAppStore.getState().reset();

    expect(useAppStore.getState().subSidebarWidth).toBe(
      SUB_SIDEBAR_WIDTH_DEFAULT,
    );
  });

  it("clamps secondary sidebar width updates to the supported range", () => {
    useAppStore.getState().reset();

    useAppStore.getState().setSubSidebarWidth(SUB_SIDEBAR_WIDTH_MIN - 50);
    expect(useAppStore.getState().subSidebarWidth).toBe(SUB_SIDEBAR_WIDTH_MIN);

    useAppStore.getState().setSubSidebarWidth(SUB_SIDEBAR_WIDTH_MAX + 50);
    expect(useAppStore.getState().subSidebarWidth).toBe(SUB_SIDEBAR_WIDTH_MAX);
  });
});

describe("useAppStore permission count actions", () => {
  beforeEach(() => {
    useAppStore.getState().reset();
    // Ensure pendingPermissionCount starts at 0 after reset
    useAppStore.setState({ pendingPermissionCount: 0 });
  });

  it("setPendingPermissionCount sets to exact value when non-negative", () => {
    useAppStore.getState().setPendingPermissionCount(5);
    expect(useAppStore.getState().pendingPermissionCount).toBe(5);
  });

  it("setPendingPermissionCount clamps to 0 for negative values", () => {
    useAppStore.getState().setPendingPermissionCount(-3);
    expect(useAppStore.getState().pendingPermissionCount).toBe(0);
  });

  it("incrementPendingPermissions increases count by 1", () => {
    useAppStore.setState({ pendingPermissionCount: 2 });
    useAppStore.getState().incrementPendingPermissions();
    expect(useAppStore.getState().pendingPermissionCount).toBe(3);
  });

  it("decrementPendingPermissions decreases count by 1 when count > 0", () => {
    useAppStore.setState({ pendingPermissionCount: 3 });
    useAppStore.getState().decrementPendingPermissions();
    expect(useAppStore.getState().pendingPermissionCount).toBe(2);
  });

  it("decrementPendingPermissions clamps to 0 and never goes negative", () => {
    useAppStore.setState({ pendingPermissionCount: 0 });
    useAppStore.getState().decrementPendingPermissions();
    expect(useAppStore.getState().pendingPermissionCount).toBe(0);
  });
});

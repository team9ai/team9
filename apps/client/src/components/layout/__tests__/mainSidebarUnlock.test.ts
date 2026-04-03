import { describe, expect, it } from "vitest";
import {
  HIDDEN_NAV_SECTION_IDS,
  HIDDEN_NAV_TAP_COUNT_STORAGE_KEY,
  HIDDEN_NAV_UNLOCK_STORAGE_KEY,
  getVisibleNavigationItems,
  isHiddenNavUnlocked,
  registerMoreTapUnlock,
} from "../mainSidebarUnlock";

const navigationItems = [
  { id: "home" },
  { id: "messages" },
  { id: "activity" },
  { id: "aiStaff" },
  { id: "tasks" },
  { id: "skills" },
  { id: "resources" },
  { id: "library" },
  { id: "application" },
  { id: "more" },
];

describe("mainSidebarUnlock", () => {
  it("hides experimental tabs before unlock", () => {
    const visibleItems = getVisibleNavigationItems(navigationItems, false);

    expect(visibleItems.map((item) => item.id)).toEqual([
      "home",
      "messages",
      "activity",
      "application",
      "more",
    ]);
  });

  it("shows all tabs after unlock", () => {
    const visibleItems = getVisibleNavigationItems(navigationItems, true);

    expect(visibleItems.map((item) => item.id)).toEqual(
      navigationItems.map((item) => item.id),
    );
  });

  it("unlocks hidden tabs after clicking More five times", () => {
    for (let i = 1; i <= 4; i += 1) {
      expect(registerMoreTapUnlock()).toBe(false);
      expect(localStorage.getItem(HIDDEN_NAV_TAP_COUNT_STORAGE_KEY)).toBe(
        String(i),
      );
      expect(isHiddenNavUnlocked()).toBe(false);
    }

    expect(registerMoreTapUnlock()).toBe(true);
    expect(isHiddenNavUnlocked()).toBe(true);
    expect(localStorage.getItem(HIDDEN_NAV_UNLOCK_STORAGE_KEY)).toBe("true");
    expect(localStorage.getItem(HIDDEN_NAV_TAP_COUNT_STORAGE_KEY)).toBeNull();
  });

  it("keeps the hidden-section list stable", () => {
    expect(HIDDEN_NAV_SECTION_IDS).toEqual([
      "aiStaff",
      "tasks",
      "skills",
      "resources",
      "library",
    ]);
  });
});

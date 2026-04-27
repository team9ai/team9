import type { Page } from "@playwright/test";

/**
 * Navigate to the /devices page and switch to the "My devices" tab so the
 * `ThisMacSection` toggle and device list are mounted. Most ahand specs
 * start here.
 */
export async function gotoMyDevicesTab(page: Page): Promise<void> {
  await page.goto("/devices");
  // Wait for the tabs to render. The trigger is keyed by translation
  // string "My devices" (devicesTabs.myDevices). Click it.
  const tab = page.getByRole("tab", { name: /My devices/i });
  await tab.waitFor({ state: "visible", timeout: 10_000 });
  await tab.click();
}

/**
 * Resolve the toggle switch in the "This Mac" section. Uses the i18n
 * aria-label so we don't depend on internal markup.
 */
export function thisMacToggle(page: Page) {
  return page.getByRole("switch", { name: /Allow as agent target/i });
}

/**
 * Resolve the local-device status badge (the colored dot + label) in the
 * "This Mac" section.
 */
export function thisMacStatusBadge(page: Page) {
  // The badge text comes from translation keys: "● Online", "Offline",
  // "⟳ Connecting…", "Disabled". We match by the parent flex container.
  return page.locator("section", { hasText: /This Mac/i }).first();
}

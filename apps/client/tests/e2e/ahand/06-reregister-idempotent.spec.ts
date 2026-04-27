import { test, expect } from "@playwright/test";

import { installMockHub } from "./fixtures/mock-hub";
import { gotoMyDevicesTab, thisMacToggle } from "./fixtures/page-helpers";

/**
 * Scenario 6 — Re-register the same device → idempotent, no UI ghost rows.
 *
 * The flow we're guarding against: a user toggles ahand off, then on
 * again. Because the Tauri stub returns the *same* identity for the
 * same `team9UserId`, re-registration should reuse the existing
 * `hubDeviceId` rather than creating a duplicate row.
 */
test.describe("ahand · re-register is idempotent", () => {
  test("toggle off → toggle on does not create a ghost row", async ({
    page,
  }) => {
    const hub = await installMockHub(page, { initialDevices: [] });

    await gotoMyDevicesTab(page);
    const toggle = thisMacToggle(page);

    // First registration.
    await toggle.click();
    await expect(page.getByText(/● Online/i).first()).toBeVisible({
      timeout: 10_000,
    });
    expect(hub.getDevices()).toHaveLength(1);
    const firstHubId = hub.getDevices()[0]!.hubDeviceId;

    // Toggle off.
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");

    // Toggle back on. Tauri stub returns the same identity for the same
    // userId, so the gateway sees an idempotent register call.
    await toggle.click();
    await expect(page.getByText(/● Online/i).first()).toBeVisible({
      timeout: 10_000,
    });

    // Still exactly one device, same hubDeviceId.
    const after = hub.getDevices();
    expect(after).toHaveLength(1);
    expect(after[0]?.hubDeviceId).toBe(firstHubId);
  });
});

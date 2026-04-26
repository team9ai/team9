import { test, expect } from "@playwright/test";

import { installMockHub } from "./fixtures/mock-hub";
import { gotoMyDevicesTab, thisMacToggle } from "./fixtures/page-helpers";

/**
 * Scenario 1 — Toggle ahand on → device appears in /devices →
 *              `isOnline: true` reflected in UI.
 *
 * Mock-mode coverage:
 *   - Click the "Allow as agent target" switch
 *   - Mock register endpoint accepts the device
 *   - Daemon stub transitions idle → connecting → online
 *   - "● Online" status text appears on the local-device badge
 */
test.describe("ahand · toggle on → online", () => {
  test("registers and reaches Online state", async ({ page }) => {
    const hub = await installMockHub(page, { initialDevices: [] });
    await gotoMyDevicesTab(page);

    // Pre-state: toggle is off.
    const toggle = thisMacToggle(page);
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-checked", "false");

    // Flip it on.
    await toggle.click();

    // The Tauri stub fires `online` on a 50ms timer, then the device list
    // refetch picks up the new row from the mock hub. Allow some headroom
    // for React/query reconciliation.
    await expect(page.getByText(/● Online/i).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(toggle).toHaveAttribute("aria-checked", "true");

    // The device row got created on the mock hub side.
    const devices = hub.getDevices();
    expect(devices).toHaveLength(1);
    expect(devices[0]?.status).toBe("active");

    // Push the WS event the real backend would emit so the listing also
    // shows isOnline:true (in mock mode the cache already shows the local
    // device via the includeOffline=true GET; we simulate the broadcast
    // for parity with live).
    await hub.emitDeviceEvent({
      type: "device.online",
      hubDeviceId: devices[0]!.hubDeviceId,
    });
  });
});

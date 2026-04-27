import { test, expect } from "@playwright/test";

import { installMockHub } from "./fixtures/mock-hub";
import { gotoMyDevicesTab } from "./fixtures/page-helpers";

/**
 * Scenario 7 — Revoke a device → all sessions to it 4xx, UI removes row.
 *
 * Mock-mode coverage:
 *   - Two devices in the user's account: the local "This Mac" plus a
 *     second mac listed under "My Other Devices".
 *   - User clicks "Remove" on the other device.
 *   - The mock hub deletes the row (returns 204) and emits `device.revoked`.
 *   - The OtherDevicesList no longer renders the row.
 */
test.describe("ahand · revoke removes UI row", () => {
  test("clicking Remove drops the row from the list", async ({ page }) => {
    const localId = "00000000-0000-4000-8000-000000000700";
    const otherHubDeviceId = "00000000-0000-4000-8000-000000000701";
    const otherRowId = "00000000-0000-4000-8000-000000000702";
    const hub = await installMockHub(page, {
      initialDaemonStatus: { state: "online", device_id: localId },
      initialDevices: [
        {
          id: "00000000-0000-4000-8000-000000000703",
          hubDeviceId: localId,
          nickname: "macos-device",
          platform: "macos",
          hostname: null,
          status: "active",
          lastSeenAt: new Date().toISOString(),
          isOnline: true,
          createdAt: "2026-04-01T00:00:00.000Z",
        },
        {
          id: otherRowId,
          hubDeviceId: otherHubDeviceId,
          nickname: "old-laptop",
          platform: "macos",
          hostname: null,
          status: "active",
          lastSeenAt: "2026-03-30T12:00:00.000Z",
          isOnline: false,
          createdAt: "2026-03-01T00:00:00.000Z",
        },
      ],
    });

    await page.addInitScript((id) => {
      const userId = "00000000-0000-4000-8000-0000000000aa";
      localStorage.setItem(
        "ahand",
        JSON.stringify({
          state: {
            usersEnabled: {
              [userId]: {
                enabled: true,
                deviceId: id,
                hubUrl: "https://hub.mock.local",
              },
            },
          },
          version: 0,
        }),
      );
    }, localId);

    await gotoMyDevicesTab(page);

    // Wait for the other-devices list to render.
    const row = page.getByText(/old-laptop/);
    await row.waitFor({ state: "visible", timeout: 10_000 });

    // Click Remove on the other-device row. The OtherDevicesList button
    // text is "Remove" (regex anchored to exclude "Remove this device").
    // Scope to the list section so we don't hit the destructive button on
    // the local "This Mac" card.
    await page
      .locator("section", { hasText: /old-laptop/ })
      .getByRole("button", { name: /^Remove$/ })
      .first()
      .click();

    // Backend should drop the row.
    await expect
      .poll(() => hub.getDevices().length, { timeout: 10_000 })
      .toBe(1);
    expect(hub.getDevices()[0]?.hubDeviceId).toBe(localId);

    // Push the WS event the real backend would emit.
    await hub.emitDeviceEvent({
      type: "device.revoked",
      hubDeviceId: otherHubDeviceId,
    });

    // UI no longer shows the revoked nickname.
    await expect(page.getByText(/old-laptop/)).toHaveCount(0, {
      timeout: 5_000,
    });
  });
});

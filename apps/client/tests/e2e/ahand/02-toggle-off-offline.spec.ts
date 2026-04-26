import { test, expect } from "@playwright/test";

import { installMockHub } from "./fixtures/mock-hub";
import { gotoMyDevicesTab, thisMacToggle } from "./fixtures/page-helpers";

/**
 * Scenario 2 — Toggle off → daemon shutdown → device row stays but
 *              `isOnline: false`.
 *
 * Pre-conditions:
 *   - One registered, online device for the current user.
 *   - Daemon initially reporting `online`.
 *   - Zustand persisted state has `enabled: true` for the user.
 *
 * After clicking the switch:
 *   - Daemon transitions to `idle`.
 *   - `isOnline` is false but the row is still listed.
 */
test.describe("ahand · toggle off → offline (row stays)", () => {
  test("daemon stops, row remains with isOnline=false", async ({ page }) => {
    const hubDeviceId = "00000000-0000-4000-8000-000000000200";
    const hub = await installMockHub(page, {
      initialDaemonStatus: { state: "online", device_id: hubDeviceId },
      initialDevices: [
        {
          id: "00000000-0000-4000-8000-000000000201",
          hubDeviceId,
          nickname: "macos-device",
          platform: "macos",
          hostname: null,
          status: "active",
          lastSeenAt: new Date().toISOString(),
          isOnline: true,
          createdAt: "2026-04-01T00:00:00.000Z",
        },
      ],
    });

    // Seed the Zustand ahand-store so the toggle starts in the "on" state.
    await page.addInitScript((id) => {
      // The persist key is `"ahand"` (Zustand persist middleware default).
      // Per src/stores/useAhandStore.ts — confirmed in test seed below.
      // We seed `usersEnabled[<userId>] = { enabled: true, deviceId, hubUrl }`.
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
    }, hubDeviceId);

    await gotoMyDevicesTab(page);
    const toggle = thisMacToggle(page);
    await expect(toggle).toHaveAttribute("aria-checked", "true", {
      timeout: 10_000,
    });

    // Flip it off.
    await toggle.click();

    // Hub flips device offline (the real backend would do this when the
    // daemon disconnects).
    await hub.emitDaemonStatus({ state: "idle" });
    await hub.emitDeviceEvent({ type: "device.offline", hubDeviceId });

    await expect(toggle).toHaveAttribute("aria-checked", "false");

    // Row should still be visible. The local "This Mac" section is the
    // current device — but `OtherDevicesList` is filtered to exclude it.
    // What we care about: the device wasn't deleted from the backend.
    const remaining = hub.getDevices();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.isOnline).toBe(false);
  });
});

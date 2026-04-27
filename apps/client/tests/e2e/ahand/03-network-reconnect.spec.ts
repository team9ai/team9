import { test, expect } from "@playwright/test";

import { installMockHub } from "./fixtures/mock-hub";
import { gotoMyDevicesTab } from "./fixtures/page-helpers";

/**
 * Scenario 3 — Kill the local network → UI flips Online → Connecting →
 *              eventually back to Online on reconnect. Watchdog logic is
 *              owned by the daemon (covered by ahandd unit tests); this
 *              spec exercises the *UI surface*: that the badge text
 *              correctly tracks `DaemonStatus` events.
 */
test.describe("ahand · network reconnect surface", () => {
  test("Online → Connecting → Online tracks daemon status events", async ({
    page,
  }) => {
    const hubDeviceId = "00000000-0000-4000-8000-000000000300";
    const hub = await installMockHub(page, {
      initialDaemonStatus: { state: "online", device_id: hubDeviceId },
      initialDevices: [
        {
          id: "00000000-0000-4000-8000-000000000301",
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
    }, hubDeviceId);

    await gotoMyDevicesTab(page);

    // Initial state: Online.
    await expect(page.getByText(/● Online/i).first()).toBeVisible({
      timeout: 10_000,
    });

    // Network drops — daemon transitions to connecting.
    await hub.emitDaemonStatus({ state: "connecting" });
    await expect(page.getByText(/Connecting/i).first()).toBeVisible({
      timeout: 5_000,
    });

    // Reconnect succeeds — daemon transitions back to online.
    await hub.emitDaemonStatus({ state: "online", device_id: hubDeviceId });
    await expect(page.getByText(/● Online/i).first()).toBeVisible({
      timeout: 5_000,
    });
  });
});

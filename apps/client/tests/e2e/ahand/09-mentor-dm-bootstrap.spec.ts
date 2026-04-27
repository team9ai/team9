import { test, expect } from "@playwright/test";

import { RUN_AGAINST_DEV_HUB } from "./fixtures/types";

/**
 * Scenario 9 — Mentor DM bootstrap → identity setup menu appears for
 *              first-DM bot.
 *
 * Live-only: this scenario depends on the gateway's first-DM bootstrap
 * flow which provisions a mentor bot, sends a greeting message, and
 * surfaces the identity setup UI. None of that is reachable from the
 * client without live IM/messages routes.
 */
test.describe("ahand · mentor DM bootstrap", () => {
  test.skip(
    !RUN_AGAINST_DEV_HUB,
    "live-hub-only: needs gateway bootstrap + mentor provisioning",
  );

  test("identity setup menu appears for first-DM bot", async ({ page }) => {
    test.fail(
      true,
      "Live setup not yet automated — needs a fresh user account and " +
        "the mentor bot bootstrap path enabled in the gateway.",
    );
    await page.goto("/");
    await expect(page).toHaveURL(/\//);
  });
});

import { test, expect } from "@playwright/test";

import { RUN_AGAINST_DEV_HUB } from "./fixtures/types";

/**
 * Scenario 4 — Bot DM `run_command` happy path → output streams back,
 *              exit code shown.
 *
 * Live-only: this scenario crosses the bot/IM/agent layers. It needs a
 * real workspace, a personal-staff bot, an enabled ahand device, and the
 * gateway → im-worker → claw-hive-api → daemon → exec round trip. The
 * mock hub fixture stops at the gateway boundary, so we only run this
 * end-to-end against the dev tier hub (set `RUN_AGAINST_DEV_HUB=1`).
 */
test.describe("ahand · bot DM run_command happy path", () => {
  test.skip(
    !RUN_AGAINST_DEV_HUB,
    "live-hub-only: needs real bot, daemon, and exec pipeline",
  );

  test("agent runs `echo hello` and returns stdout + exit code", async ({
    page,
  }) => {
    test.fail(
      true,
      "Live setup not yet automated — needs a provisioned workspace, " +
        "a personal-staff bot, and an enabled ahand device. Tracked under " +
        "Phase 9 / Task 9.4 follow-up.",
    );
    await page.goto("/");
    await expect(page).toHaveURL(/\//);
  });
});

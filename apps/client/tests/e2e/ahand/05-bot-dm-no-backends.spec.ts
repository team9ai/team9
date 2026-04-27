import { test, expect } from "@playwright/test";

import { RUN_AGAINST_DEV_HUB } from "./fixtures/types";

/**
 * Scenario 5 — Bot DM `run_command` on offline device →
 *              "No backends are registered" surfaced cleanly.
 *
 * Live-only for the same reason as scenario 4 — the error string is
 * produced by the agent when claw-hive-api reports zero registered
 * backends, so the test needs the full IM + agent stack.
 */
test.describe("ahand · bot DM run_command (no backends)", () => {
  test.skip(
    !RUN_AGAINST_DEV_HUB,
    "live-hub-only: needs real bot + agent error surface",
  );

  test("agent surfaces 'No backends are registered' cleanly", async ({
    page,
  }) => {
    test.fail(
      true,
      "Live setup not yet automated — needs a provisioned workspace " +
        "with a bot DM but no online ahand devices.",
    );
    await page.goto("/");
    await expect(page).toHaveURL(/\//);
  });
});

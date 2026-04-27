import { test, expect } from "@playwright/test";

import { RUN_AGAINST_DEV_HUB } from "./fixtures/types";

/**
 * Scenario 8 — Multi-device user → bot sees all devices in
 *              `<ahand-context>` XML, `run_command` picks correct backend.
 *
 * Live-only: needs the gateway's IM context-marshaller, an agent that
 * can read `<ahand-context>`, and a real run_command dispatch. The mock
 * hub fixture only stubs the gateway HTTP/WS surface seen by the
 * desktop client, not the agent's view.
 */
test.describe("ahand · multi-device <ahand-context> dispatch", () => {
  test.skip(
    !RUN_AGAINST_DEV_HUB,
    "live-hub-only: needs IM context marshaller + agent",
  );

  test("agent picks the correct backend by name", async ({ page }) => {
    test.fail(
      true,
      "Live setup not yet automated — needs two enabled devices on the " +
        "same user and an agent prompt that targets one by nickname.",
    );
    await page.goto("/");
    await expect(page).toHaveURL(/\//);
  });
});

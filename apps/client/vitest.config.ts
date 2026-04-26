import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    testTimeout: 15000,
    setupFiles: ["./src/test-setup.ts"],
    // Vitest co-locates with `*.test.{ts,tsx}` under `src/`. The
    // Playwright suite lives under `tests/e2e/**/*.spec.ts` and has no
    // place in vitest's discovery (importing `@playwright/test` from a
    // jsdom worker crashes module load).
    exclude: ["**/node_modules/**", "**/dist/**", "tests/**"],
    coverage: {
      provider: "v8",
      reportsDirectory: "./coverage",
      reporter: ["text", "json-summary", "lcov"],
    },
  },
});

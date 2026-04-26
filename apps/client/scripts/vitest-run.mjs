import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);

if (args[0] === "--") {
  args.shift();
}

// `node ./scripts/vitest-run.mjs --watch` selects watch mode; otherwise
// we run a single pass via `vitest run`.
const watchIdx = args.indexOf("--watch");
const watchMode = watchIdx !== -1;
if (watchMode) args.splice(watchIdx, 1);
const vitestArgs = watchMode ? args : ["run", ...args];

if (!process.env.npm_execpath) {
  console.error("npm_execpath is required to run vitest");
  process.exit(1);
}

// Node 25 introduced an experimental global `localStorage` whose methods
// are undefined when `--localstorage-file=<path>` isn't supplied. That
// shadows jsdom's own Storage and crashes any production module that
// reads `localStorage.getItem(...)` at import time (e.g. `src/i18n/index.ts`).
// On Node 25+ we force the experimental webstorage off so jsdom — set up
// by `vitest.config.ts` — owns the global. On older Node versions the
// flag is rejected, so probe before applying.
const major = Number(process.versions.node.split(".")[0]);
const nodeOptions =
  major >= 25
    ? [process.env.NODE_OPTIONS, "--no-webstorage"].filter(Boolean).join(" ")
    : (process.env.NODE_OPTIONS ?? "");

const result = spawnSync(
  process.execPath,
  [process.env.npm_execpath, "exec", "vitest", ...vitestArgs],
  {
    stdio: "inherit",
    env: { ...process.env, NODE_OPTIONS: nodeOptions },
  },
);

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);

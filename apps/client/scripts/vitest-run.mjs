import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);

if (args[0] === "--") {
  args.shift();
}

if (!process.env.npm_execpath) {
  console.error("npm_execpath is required to run vitest");
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [process.env.npm_execpath, "exec", "vitest", "run", ...args],
  {
    stdio: "inherit",
  },
);

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Generator, getConfig } from "@tanstack/router-generator";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const clientRoot = resolve(scriptDir, "..");

const config = getConfig({ autoCodeSplitting: true }, clientRoot);
const generator = new Generator({
  config,
  root: clientRoot,
});

await generator.run();

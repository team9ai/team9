import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

type TauriConfig = {
  identifier?: string;
  plugins?: {
    "deep-link"?: {
      desktop?: {
        schemes?: string[];
      };
    };
  };
};

const clientRoot = resolve(__dirname, "../../..");

function readConfig(name: string): TauriConfig {
  return JSON.parse(
    readFileSync(resolve(clientRoot, "src-tauri", name), "utf8"),
  ) as TauriConfig;
}

describe("Tauri environment configs", () => {
  it("declares unique package identifiers for prod, dev, and local builds", () => {
    const configs = [
      readConfig("tauri.conf.json"),
      readConfig("tauri.dev.conf.json"),
      readConfig("tauri.local.conf.json"),
    ];

    const identifiers = configs.map((config) => config.identifier);

    expect(identifiers).toEqual([
      "com.weight-wave.team9-client",
      "com.weight-wave.team9-client.dev",
      "com.weight-wave.team9-client.local",
    ]);
    expect(new Set(identifiers).size).toBe(identifiers.length);
  });

  it("declares a separate local deep-link scheme", () => {
    expect(
      readConfig("tauri.conf.json").plugins?.["deep-link"]?.desktop?.schemes,
    ).toEqual(["team9"]);
    expect(
      readConfig("tauri.local.conf.json").plugins?.["deep-link"]?.desktop
        ?.schemes,
    ).toEqual(["team9-local"]);
  });
});

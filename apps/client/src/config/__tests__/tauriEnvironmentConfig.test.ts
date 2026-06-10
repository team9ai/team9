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

type PackageJson = {
  scripts?: Record<string, string>;
};

const clientRoot = resolve(__dirname, "../../..");

function readConfig(name: string): TauriConfig {
  return JSON.parse(
    readFileSync(resolve(clientRoot, "src-tauri", name), "utf8"),
  ) as TauriConfig;
}

function readPackageJson(): PackageJson {
  return JSON.parse(
    readFileSync(resolve(clientRoot, "package.json"), "utf8"),
  ) as PackageJson;
}

describe("Tauri environment configs", () => {
  it("declares unique package identifiers for prod, staging, dev, and local builds", () => {
    const configs = [
      readConfig("tauri.conf.json"),
      readConfig("tauri.staging.conf.json"),
      readConfig("tauri.dev.conf.json"),
      readConfig("tauri.local.conf.json"),
    ];

    const identifiers = configs.map((config) => config.identifier);

    expect(identifiers).toEqual([
      "com.weight-wave.team9-client",
      "com.weight-wave.team9-client.staging",
      "com.weight-wave.team9-client.dev",
      "com.weight-wave.team9-client.local",
    ]);
    expect(new Set(identifiers).size).toBe(identifiers.length);
  });

  it("declares separate deep-link schemes for prod, staging, dev, and local builds", () => {
    expect(
      readConfig("tauri.conf.json").plugins?.["deep-link"]?.desktop?.schemes,
    ).toEqual(["team9"]);
    expect(
      readConfig("tauri.staging.conf.json").plugins?.["deep-link"]?.desktop
        ?.schemes,
    ).toEqual(["team9-staging"]);
    expect(
      readConfig("tauri.dev.conf.json").plugins?.["deep-link"]?.desktop
        ?.schemes,
    ).toEqual(["team9-dev"]);
    expect(
      readConfig("tauri.local.conf.json").plugins?.["deep-link"]?.desktop
        ?.schemes,
    ).toEqual(["team9-local"]);
  });

  it("injects matching desktop deep-link schemes in environment build scripts", () => {
    const scripts = readPackageJson().scripts ?? {};

    expect(scripts["build:dev"]).toContain(
      "VITE_DESKTOP_DEEP_LINK_SCHEME=team9-dev",
    );
    expect(scripts["build:staging"]).toContain(
      "VITE_DESKTOP_DEEP_LINK_SCHEME=team9-staging",
    );
    expect(scripts["dev:desktop:dev"]).toContain(
      "VITE_DESKTOP_DEEP_LINK_SCHEME=team9-dev",
    );
    expect(scripts["build:mac:dev"]).toContain(
      "VITE_DESKTOP_DEEP_LINK_SCHEME=team9-dev",
    );
    expect(scripts["build:windows:dev"]).toContain(
      "VITE_DESKTOP_DEEP_LINK_SCHEME=team9-dev",
    );
    expect(scripts["dev:desktop:staging"]).toContain(
      "VITE_DESKTOP_DEEP_LINK_SCHEME=team9-staging",
    );
    expect(scripts["build:mac:staging"]).toContain(
      "VITE_DESKTOP_DEEP_LINK_SCHEME=team9-staging",
    );
    expect(scripts["build:windows:staging"]).toContain(
      "VITE_DESKTOP_DEEP_LINK_SCHEME=team9-staging",
    );
  });
});

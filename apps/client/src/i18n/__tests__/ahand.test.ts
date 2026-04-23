import { describe, it, expect } from "vitest";

import enAhand from "../locales/en/ahand.json";
import zhCNAhand from "../locales/zh-CN/ahand.json";
import zhTWAhand from "../locales/zh-TW/ahand.json";
import jaAhand from "../locales/ja/ahand.json";
import koAhand from "../locales/ko/ahand.json";
import esAhand from "../locales/es/ahand.json";
import ptAhand from "../locales/pt/ahand.json";
import frAhand from "../locales/fr/ahand.json";
import deAhand from "../locales/de/ahand.json";
import itAhand from "../locales/it/ahand.json";
import nlAhand from "../locales/nl/ahand.json";
import ruAhand from "../locales/ru/ahand.json";

import { NAMESPACES } from "../loadLanguage";

type JsonObject = Record<string, unknown>;

function flatKeys(obj: JsonObject, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out.push(...flatKeys(v as JsonObject, key));
    } else {
      out.push(key);
    }
  }
  return out;
}

// Canonical keys declared by Phase 8 design (spec §5 + plan Task 8.6).
// Every component in Phase 8 that calls t("ahand.X") must resolve to one
// of these keys; the English file is the source of truth.
const REQUIRED_KEYS = [
  "myDevices",
  "thisMac",
  "otherDevices_zero",
  "otherDevices_one",
  "otherDevices_other",
  "allowLocalDevice",
  "removeThisDevice",
  "confirmRemoveThisMac",
  "confirmRemove",
  "thisMacRemoved",
  "removed",
  "remove",
  "online",
  "offline",
  "connecting",
  "disabled",
  "notConnected",
  "statusAnyOnline",
  "statusNoneOnline",
  "lastSeen",
  "neverSeen",
  "error.header",
  "error.jwtExpired",
  "error.hubUnavailable",
  "error.toggleFailed",
  "error.removeFailed",
  "ctaTitle",
  "ctaBody",
  "ctaPrimaryAction",
  "ctaSecondaryAction",
  "noAppInstalledHint",
];

const LOCALES: Record<string, JsonObject> = {
  en: enAhand as JsonObject,
  "zh-CN": zhCNAhand as JsonObject,
  "zh-TW": zhTWAhand as JsonObject,
  ja: jaAhand as JsonObject,
  ko: koAhand as JsonObject,
  es: esAhand as JsonObject,
  pt: ptAhand as JsonObject,
  fr: frAhand as JsonObject,
  de: deAhand as JsonObject,
  it: itAhand as JsonObject,
  nl: nlAhand as JsonObject,
  ru: ruAhand as JsonObject,
};

describe("i18n ahand namespace", () => {
  it("registers 'ahand' in the shared NAMESPACES list", () => {
    expect(NAMESPACES).toContain("ahand");
  });

  it("English source declares every required key", () => {
    const actual = new Set(flatKeys(enAhand as JsonObject));
    for (const k of REQUIRED_KEYS) {
      expect(actual.has(k), `en/ahand.json missing key: ${k}`).toBe(true);
    }
  });

  it.each(Object.entries(LOCALES))(
    "%s exposes the full key set (parity with English)",
    (_locale, file) => {
      const actual = new Set(flatKeys(file));
      for (const k of REQUIRED_KEYS) {
        expect(actual.has(k), `missing key: ${k}`).toBe(true);
      }
    },
  );

  it.each(Object.entries(LOCALES))(
    "%s interpolation placeholders match English",
    (_locale, file) => {
      const enKeys = flatKeys(enAhand as JsonObject);
      for (const key of enKeys) {
        const enValue = keyPath(enAhand as JsonObject, key);
        const locValue = keyPath(file, key);
        if (typeof enValue !== "string" || typeof locValue !== "string")
          continue;
        const enPlaceholders = extractPlaceholders(enValue);
        const locPlaceholders = extractPlaceholders(locValue);
        expect(
          [...locPlaceholders].sort(),
          `${key} placeholder set must match English`,
        ).toEqual([...enPlaceholders].sort());
      }
    },
  );

  it.each(Object.entries(LOCALES))(
    "%s has no empty string values",
    (_locale, file) => {
      const keys = flatKeys(file);
      for (const key of keys) {
        const v = keyPath(file, key);
        if (typeof v !== "string") continue;
        expect(v.length, `${key} must not be empty`).toBeGreaterThan(0);
      }
    },
  );
});

function keyPath(obj: JsonObject, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in (cur as JsonObject)) {
      cur = (cur as JsonObject)[p];
    } else {
      return undefined;
    }
  }
  return cur;
}

function extractPlaceholders(s: string): string[] {
  const m = s.match(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g);
  if (!m) return [];
  return m.map((x) => x.replace(/[{}\s]/g, ""));
}

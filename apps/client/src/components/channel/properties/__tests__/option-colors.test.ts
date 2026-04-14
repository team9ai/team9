import { describe, expect, it } from "vitest";
import {
  OPTION_COLOR_CLASS,
  OPTION_COLOR_KEYS,
  OPTION_COLOR_LABEL,
  OPTION_COLOR_SWATCH,
  getOptionChipProps,
  getOptionColorClass,
  getOptionColorSwatch,
} from "../option-colors";

describe("option-colors", () => {
  it("exposes the same keys across all lookup tables", () => {
    for (const key of OPTION_COLOR_KEYS) {
      expect(OPTION_COLOR_CLASS[key]).toBeTruthy();
      expect(OPTION_COLOR_SWATCH[key]).toBeTruthy();
      expect(OPTION_COLOR_LABEL[key]).toBeTruthy();
    }
  });

  describe("getOptionColorClass", () => {
    it("returns the default class when color is missing", () => {
      expect(getOptionColorClass()).toBe(OPTION_COLOR_CLASS.default);
      expect(getOptionColorClass(undefined)).toBe(OPTION_COLOR_CLASS.default);
      expect(getOptionColorClass(null)).toBe(OPTION_COLOR_CLASS.default);
      expect(getOptionColorClass("")).toBe(OPTION_COLOR_CLASS.default);
    });

    it("returns the mapped class for every known named color", () => {
      for (const key of OPTION_COLOR_KEYS) {
        expect(getOptionColorClass(key)).toBe(OPTION_COLOR_CLASS[key]);
      }
    });

    it("falls back to default for unknown or legacy hex values", () => {
      expect(getOptionColorClass("#ef4444")).toBe(OPTION_COLOR_CLASS.default);
      expect(getOptionColorClass("mauve")).toBe(OPTION_COLOR_CLASS.default);
    });
  });

  describe("getOptionColorSwatch", () => {
    it("returns undefined when color is missing or explicit default", () => {
      expect(getOptionColorSwatch()).toBeUndefined();
      expect(getOptionColorSwatch(undefined)).toBeUndefined();
      expect(getOptionColorSwatch(null)).toBeUndefined();
      expect(getOptionColorSwatch("")).toBeUndefined();
      expect(getOptionColorSwatch("default")).toBeUndefined();
    });

    it("returns the hex swatch for every non-default named color", () => {
      for (const key of OPTION_COLOR_KEYS) {
        if (key === "default") continue;
        expect(getOptionColorSwatch(key)).toBe(OPTION_COLOR_SWATCH[key]);
      }
    });

    it("passes through legacy raw CSS values unchanged", () => {
      expect(getOptionColorSwatch("#ef4444")).toBe("#ef4444");
      expect(getOptionColorSwatch("rgb(1, 2, 3)")).toBe("rgb(1, 2, 3)");
    });
  });

  describe("getOptionChipProps", () => {
    it("returns the default class with no style when unset or 'default'", () => {
      for (const color of [undefined, null, "", "default"]) {
        const chip = getOptionChipProps(color);
        expect(chip.className).toBe(OPTION_COLOR_CLASS.default);
        expect(chip.style).toBeUndefined();
      }
    });

    it("returns the Tailwind class for every named color with no inline style", () => {
      for (const key of OPTION_COLOR_KEYS) {
        if (key === "default") continue;
        const chip = getOptionChipProps(key);
        expect(chip.className).toBe(OPTION_COLOR_CLASS[key]);
        expect(chip.style).toBeUndefined();
      }
    });

    it("produces a tinted inline style for legacy 6-digit hex values", () => {
      const chip = getOptionChipProps("#ef4444");
      expect(chip.className).toBe("");
      expect(chip.style).toEqual({
        backgroundColor: "#ef444433",
        color: "#ef4444",
      });
    });

    it("uses the raw color as-is for non-hex legacy values", () => {
      const chip = getOptionChipProps("rgb(1, 2, 3)");
      expect(chip.className).toBe("");
      expect(chip.style).toEqual({
        backgroundColor: "rgb(1, 2, 3)",
        color: "rgb(1, 2, 3)",
      });
    });
  });
});

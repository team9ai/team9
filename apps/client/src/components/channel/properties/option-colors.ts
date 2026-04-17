/**
 * Named color palette for select/multi-select/tags options.
 *
 * Values stored in {@link SelectOption.color} should be one of
 * {@link OPTION_COLOR_KEYS}. Legacy hex values (e.g. "#ef4444") still
 * render via the swatch fallback so old data keeps working.
 */

export type OptionColorKey =
  | "default"
  | "gray"
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "blue"
  | "purple"
  | "pink";

export const OPTION_COLOR_KEYS: OptionColorKey[] = [
  "default",
  "gray",
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
];

export const OPTION_COLOR_LABEL: Record<OptionColorKey, string> = {
  default: "Default",
  gray: "Gray",
  red: "Red",
  orange: "Orange",
  yellow: "Yellow",
  green: "Green",
  blue: "Blue",
  purple: "Purple",
  pink: "Pink",
};

/** Tailwind classes for chip background + text (respects dark mode). */
export const OPTION_COLOR_CLASS: Record<OptionColorKey, string> = {
  default: "bg-secondary text-secondary-foreground",
  gray: "bg-gray-100 text-gray-800 dark:bg-gray-900/40 dark:text-gray-300",
  red: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  orange:
    "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  yellow:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  green: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  blue: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  purple:
    "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  pink: "bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-300",
};

/** Hex swatches for small preview dots / picker tiles. */
export const OPTION_COLOR_SWATCH: Record<OptionColorKey, string> = {
  default: "transparent",
  gray: "#9ca3af",
  red: "#ef4444",
  orange: "#f97316",
  yellow: "#eab308",
  green: "#22c55e",
  blue: "#3b82f6",
  purple: "#a855f7",
  pink: "#ec4899",
};

function isKnownKey(color: string): color is OptionColorKey {
  return color in OPTION_COLOR_CLASS;
}

/**
 * Tailwind class for a chip background/text.
 * Unknown values (including legacy hex) fall back to the default class — the
 * raw swatch color is exposed separately via {@link getOptionColorSwatch}.
 */
export function getOptionColorClass(color?: string | null): string {
  if (!color) return OPTION_COLOR_CLASS.default;
  if (isKnownKey(color)) return OPTION_COLOR_CLASS[color];
  return OPTION_COLOR_CLASS.default;
}

/**
 * Hex/CSS color for small preview dots.
 * - Known key → its swatch hex.
 * - Legacy raw CSS value (e.g. "#ef4444") → returned as-is.
 * - "default" or unset → `undefined` (caller hides the dot).
 */
export function getOptionColorSwatch(
  color?: string | null,
): string | undefined {
  if (!color || color === "default") return undefined;
  if (isKnownKey(color)) return OPTION_COLOR_SWATCH[color];
  return color;
}

/**
 * Chip background + text styling. Returns a Tailwind class for named keys
 * (dark-mode aware) and an inline-style tint for legacy raw CSS values, so
 * both persistence formats render visibly.
 */
export function getOptionChipProps(color?: string | null): {
  className: string;
  style?: { backgroundColor: string; color: string };
} {
  if (!color || color === "default") {
    return { className: OPTION_COLOR_CLASS.default };
  }
  if (isKnownKey(color)) {
    return { className: OPTION_COLOR_CLASS[color] };
  }
  // Legacy raw CSS value — tint the background, keep the raw color as text.
  const isHex6 = /^#[0-9a-f]{6}$/i.test(color);
  return {
    className: "",
    style: {
      backgroundColor: isHex6 ? `${color}33` : color,
      color,
    },
  };
}

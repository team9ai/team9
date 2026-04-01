export const AVATAR_GRADIENTS = [
  "from-indigo-500 to-blue-400",
  "from-violet-500 to-purple-400",
  "from-rose-500 to-pink-400",
  "from-emerald-500 to-teal-400",
  "from-amber-500 to-orange-400",
  "from-cyan-500 to-sky-400",
  "from-fuchsia-500 to-pink-400",
  "from-lime-600 to-green-500",
  "from-blue-500 to-indigo-400",
  "from-orange-500 to-red-400",
  "from-sky-500 to-blue-400",
  "from-teal-500 to-cyan-400",
  "from-green-600 to-emerald-500",
  "from-red-500 to-rose-400",
  "from-pink-500 to-fuchsia-400",
  "from-purple-500 to-violet-400",
  "from-indigo-600 to-sky-500",
  "from-emerald-600 to-green-500",
  "from-blue-600 to-cyan-500",
  "from-rose-600 to-red-500",
  "from-orange-600 to-amber-500",
  "from-teal-600 to-emerald-500",
  "from-violet-600 to-indigo-500",
  "from-fuchsia-600 to-purple-500",
  "from-cyan-600 to-blue-500",
  "from-green-700 to-emerald-500",
  "from-red-600 to-orange-500",
  "from-pink-600 to-rose-500",
  "from-sky-600 to-indigo-500",
  "from-amber-600 to-red-500",
] as const;

type GraphemeSegment = {
  segment: string;
};

type GraphemeSegmenter = {
  segment(input: string): Iterable<GraphemeSegment>;
};

type IntlWithOptionalSegmenter = typeof Intl & {
  Segmenter?: new (
    locales?: string | string[],
    options?: { granularity?: "grapheme" | "word" | "sentence" },
  ) => GraphemeSegmenter;
};

let cachedIntlRef: typeof Intl | undefined;
let cachedGraphemeSegmenter: GraphemeSegmenter | null | undefined;

function hashSeed(seed: string): number {
  let hash = 5381;

  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash << 5) + hash + seed.charCodeAt(i);
    hash |= 0;
  }

  return Math.abs(hash);
}

function getGraphemeSegmenter(): GraphemeSegmenter | null {
  if (typeof Intl === "undefined") {
    cachedIntlRef = undefined;
    cachedGraphemeSegmenter = null;
    return null;
  }

  if (cachedIntlRef === Intl && cachedGraphemeSegmenter !== undefined) {
    return cachedGraphemeSegmenter;
  }

  const intlWithSegmenter = Intl as IntlWithOptionalSegmenter;
  cachedIntlRef = Intl;

  if (typeof intlWithSegmenter.Segmenter !== "function") {
    cachedGraphemeSegmenter = null;
    return null;
  }

  cachedGraphemeSegmenter = new intlWithSegmenter.Segmenter(undefined, {
    granularity: "grapheme",
  });

  return cachedGraphemeSegmenter;
}

function getFirstDisplayedGrapheme(value: string): string {
  const segmenter = getGraphemeSegmenter();

  if (segmenter) {
    const firstSegment = segmenter.segment(value)[Symbol.iterator]().next()
      .value?.segment;

    return firstSegment ?? "";
  }

  return Array.from(value.normalize("NFC"))[0] ?? "";
}

function getInitialFromPart(part: string): string {
  return getFirstDisplayedGrapheme(part.toUpperCase());
}

export function getSeededAvatarGradient(seed?: string | null): string {
  const normalizedSeed = seed?.trim() || "?";
  const index = hashSeed(normalizedSeed) % AVATAR_GRADIENTS.length;

  return AVATAR_GRADIENTS[index];
}

export function getInitials(name?: string | null): string {
  const normalizedName = name?.trim();

  if (!normalizedName) {
    return "?";
  }

  const parts = normalizedName.split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return "?";
  }

  const first = getInitialFromPart(parts[0] ?? "");
  const second = getInitialFromPart(parts[1] ?? "");

  return first + second || "?";
}

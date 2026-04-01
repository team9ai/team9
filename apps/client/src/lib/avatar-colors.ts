export const AVATAR_GRADIENTS = [
  "from-indigo-500 to-blue-400",
  "from-violet-500 to-purple-400",
  "from-rose-400 to-pink-400",
  "from-emerald-500 to-teal-400",
  "from-amber-400 to-orange-400",
  "from-cyan-500 to-sky-400",
  "from-fuchsia-500 to-pink-400",
  "from-lime-500 to-green-400",
  "from-blue-500 to-indigo-400",
  "from-orange-500 to-red-400",
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

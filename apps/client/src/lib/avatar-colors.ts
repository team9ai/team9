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

function hashSeed(seed: string): number {
  let hash = 5381;

  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash << 5) + hash + seed.charCodeAt(i);
    hash |= 0;
  }

  return Math.abs(hash);
}

function getFirstDisplayedGrapheme(value: string): string {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter(undefined, {
      granularity: "grapheme",
    });
    const firstSegment = segmenter.segment(value)[Symbol.iterator]().next()
      .value?.segment;

    return firstSegment ?? "";
  }

  return Array.from(value)[0] ?? "";
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

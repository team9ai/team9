const STORAGE_PREFIX = "team9:streaming-metadata:";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getDeltaText(metadata: Record<string, unknown>): string | undefined {
  if (typeof metadata.toolArgsTextDelta === "string") {
    return metadata.toolArgsTextDelta;
  }
  if (typeof metadata.toolArgsDelta === "string") {
    return metadata.toolArgsDelta;
  }

  const deltaData = metadata.deltaData;
  if (!isRecord(deltaData)) return undefined;

  if (typeof deltaData.toolArgsText === "string") {
    return deltaData.toolArgsText;
  }
  if (typeof deltaData.toolArgsTextDelta === "string") {
    return deltaData.toolArgsTextDelta;
  }
  if (typeof deltaData.toolArgs === "string") {
    return deltaData.toolArgs;
  }

  return undefined;
}

function stripTransientDeltaFields(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const {
    deltaData: _deltaData,
    toolArgsTextDelta: _toolArgsTextDelta,
    toolArgsDelta: _toolArgsDelta,
    ...rest
  } = metadata;
  return rest;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function recordArray(value: unknown): Record<string, unknown>[] | undefined {
  return Array.isArray(value) ? value.filter(isRecord) : undefined;
}

function mergeThoughtText(previous: unknown, incoming: unknown): string | null {
  const previousText = stringValue(previous);
  const incomingText = stringValue(incoming);
  if (!previousText && !incomingText) return null;
  if (!previousText) return incomingText ?? null;
  if (!incomingText) return previousText;
  return previousText.length > incomingText.length
    ? previousText
    : incomingText;
}

function mergeThoughtStatus(
  previous: unknown,
  incoming: unknown,
): string | null {
  const previousStatus = stringValue(previous);
  const incomingStatus = stringValue(incoming);
  if (previousStatus === "completed" || incomingStatus === "completed") {
    return "completed";
  }
  return incomingStatus ?? previousStatus ?? null;
}

function thoughtKey(thought: Record<string, unknown>): string | undefined {
  const id = stringValue(thought.id);
  if (id) return `id:${id}`;
  const text = stringValue(thought.text);
  if (text) return `text:${text}`;
  return undefined;
}

function mergeThought(
  previous: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const text = mergeThoughtText(previous.text, incoming.text);
  const status = mergeThoughtStatus(previous.status, incoming.status);
  return {
    ...previous,
    ...incoming,
    ...(text ? { text } : {}),
    ...(status ? { status } : {}),
  };
}

function mergeThoughts(
  previous: unknown,
  incoming: unknown,
): Record<string, unknown>[] | undefined {
  const previousThoughts = recordArray(previous);
  const incomingThoughts = recordArray(incoming);
  if (!previousThoughts?.length && !incomingThoughts?.length) return undefined;
  if (!previousThoughts?.length) return incomingThoughts;
  if (!incomingThoughts?.length) return previousThoughts;

  const merged = [...previousThoughts];
  const byKey = new Map<string, number>();
  previousThoughts.forEach((thought, index) => {
    const key = thoughtKey(thought);
    if (key) byKey.set(key, index);
  });

  for (const thought of incomingThoughts) {
    const key = thoughtKey(thought);
    const existingIndex = key ? byKey.get(key) : undefined;
    if (existingIndex === undefined) {
      merged.push(thought);
      if (key) byKey.set(key, merged.length - 1);
      continue;
    }

    const existing = merged[existingIndex];
    merged[existingIndex] = existing
      ? mergeThought(existing, thought)
      : thought;
  }

  return merged.slice(-8);
}

function sourceKey(source: Record<string, unknown>): string | undefined {
  const id = stringValue(source.id);
  if (id) return `id:${id}`;
  const url = stringValue(source.url);
  if (url) return `url:${url}`;
  return undefined;
}

function mergeSources(
  previous: unknown,
  incoming: unknown,
): Record<string, unknown>[] | undefined {
  const previousSources = recordArray(previous);
  const incomingSources = recordArray(incoming);
  if (!previousSources?.length && !incomingSources?.length) return undefined;
  if (!previousSources?.length) return incomingSources;
  if (!incomingSources?.length) return previousSources;

  const merged = [...previousSources];
  const byKey = new Map<string, number>();
  previousSources.forEach((source, index) => {
    const key = sourceKey(source);
    if (key) byKey.set(key, index);
  });

  for (const source of incomingSources) {
    const key = sourceKey(source);
    const existingIndex = key ? byKey.get(key) : undefined;
    if (existingIndex === undefined) {
      merged.push(source);
      if (key) byKey.set(key, merged.length - 1);
      continue;
    }

    merged[existingIndex] = {
      ...(merged[existingIndex] ?? {}),
      ...source,
    };
  }

  return merged.slice(0, 32);
}

function mergeQueries(
  previous: unknown,
  incoming: unknown,
): string[] | undefined {
  const previousQueries = Array.isArray(previous)
    ? previous.map(stringValue).filter((item): item is string => Boolean(item))
    : [];
  const incomingQueries = Array.isArray(incoming)
    ? incoming.map(stringValue).filter((item): item is string => Boolean(item))
    : [];
  const merged: string[] = [];
  for (const query of [...previousQueries, ...incomingQueries]) {
    if (!merged.includes(query)) merged.push(query);
  }
  return merged.length > 0 ? merged.slice(0, 16) : undefined;
}

function mergeDeepResearchProgress(
  previous: unknown,
  incoming: unknown,
): unknown {
  if (!isRecord(previous) || !isRecord(incoming)) {
    return incoming ?? previous;
  }

  const thoughts = mergeThoughts(previous.thoughts, incoming.thoughts);
  const sources = mergeSources(previous.sources, incoming.sources);
  const queries = mergeQueries(previous.queries, incoming.queries);
  const counts =
    isRecord(previous.counts) || isRecord(incoming.counts)
      ? {
          ...(isRecord(previous.counts) ? previous.counts : {}),
          ...(isRecord(incoming.counts) ? incoming.counts : {}),
        }
      : undefined;

  return {
    ...previous,
    ...incoming,
    ...(thoughts ? { thoughts } : {}),
    ...(sources ? { sources } : {}),
    ...(queries ? { queries } : {}),
    ...(counts ? { counts } : {}),
  };
}

function mergeDeepResearchMetadata(
  previous: unknown,
  incoming: unknown,
): unknown {
  if (!isRecord(previous) || !isRecord(incoming)) {
    return incoming;
  }

  const next = {
    ...previous,
    ...incoming,
  };

  if ("progress" in incoming || "progress" in previous) {
    next.progress = mergeDeepResearchProgress(
      previous.progress,
      incoming.progress,
    );
  }

  return next;
}

export function mergeStreamingMetadata(
  previous: Record<string, unknown> | undefined,
  incoming: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!incoming) return previous;

  const deltaText = getDeltaText(incoming);
  const next = {
    ...(previous ?? {}),
    ...stripTransientDeltaFields(incoming),
  };

  if ("deepResearch" in incoming) {
    next.deepResearch = mergeDeepResearchMetadata(
      previous?.deepResearch,
      incoming.deepResearch,
    );
  }

  if (deltaText !== undefined) {
    const previousText =
      typeof previous?.toolArgsText === "string" ? previous.toolArgsText : "";
    next.toolArgsText = `${previousText}${deltaText}`;
  }

  return next;
}

function getStorage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  return window.sessionStorage;
}

export function loadPersistedStreamMetadata(
  streamId: string,
): Record<string, unknown> | undefined {
  try {
    const raw = getStorage()?.getItem(`${STORAGE_PREFIX}${streamId}`);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function persistStreamMetadata(
  streamId: string,
  metadata: Record<string, unknown> | undefined,
): void {
  try {
    const storage = getStorage();
    if (!storage) return;
    if (!metadata) {
      storage.removeItem(`${STORAGE_PREFIX}${streamId}`);
      return;
    }
    storage.setItem(`${STORAGE_PREFIX}${streamId}`, JSON.stringify(metadata));
  } catch {
    // sessionStorage can be unavailable in private or constrained contexts.
  }
}

export function clearPersistedStreamMetadata(streamId: string): void {
  persistStreamMetadata(streamId, undefined);
}

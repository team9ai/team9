function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getDeltaText(metadata: Record<string, unknown>): string | undefined {
  if (typeof metadata.toolArgsTextDelta === 'string') {
    return metadata.toolArgsTextDelta;
  }
  if (typeof metadata.toolArgsDelta === 'string') {
    return metadata.toolArgsDelta;
  }

  const deltaData = metadata.deltaData;
  if (!isRecord(deltaData)) return undefined;

  if (typeof deltaData.toolArgsText === 'string') {
    return deltaData.toolArgsText;
  }
  if (typeof deltaData.toolArgsTextDelta === 'string') {
    return deltaData.toolArgsTextDelta;
  }
  if (typeof deltaData.toolArgs === 'string') {
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

  if (!('progress' in incoming) && 'progress' in previous) {
    next.progress = previous.progress;
  }

  return next;
}

export function mergeStreamingMetadataSnapshot(
  previous: Record<string, unknown> | undefined,
  incoming: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!incoming) return previous;

  const deltaText = getDeltaText(incoming);
  const next = {
    ...(previous ?? {}),
    ...stripTransientDeltaFields(incoming),
  };

  if ('deepResearch' in incoming) {
    next.deepResearch = mergeDeepResearchMetadata(
      previous?.deepResearch,
      incoming.deepResearch,
    );
  }

  if (deltaText !== undefined) {
    const previousText =
      typeof previous?.toolArgsText === 'string' ? previous.toolArgsText : '';
    next.toolArgsText = `${previousText}${deltaText}`;
  }

  return next;
}

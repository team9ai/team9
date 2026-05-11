function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
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

  if (deltaText !== undefined) {
    const previousText =
      typeof previous?.toolArgsText === 'string' ? previous.toolArgsText : '';
    next.toolArgsText = `${previousText}${deltaText}`;
  }

  return next;
}

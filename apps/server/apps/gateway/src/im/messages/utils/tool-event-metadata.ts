type Metadata = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function unwrapTextContent(raw: string): string {
  const parsed = parseJson(raw);
  if (isRecord(parsed) && Array.isArray(parsed.content)) {
    const text = parsed.content
      .filter(
        (block): block is { type: string; text: string } =>
          isRecord(block) &&
          block.type === 'text' &&
          typeof block.text === 'string',
      )
      .map((block) => block.text)
      .join('\n');

    if (text) return text;
  }

  return raw;
}

function getExplicitFailureMessage(content: string): string | undefined {
  const unwrapped = unwrapTextContent(content);
  const parsed = parseJson(unwrapped);

  if (!isRecord(parsed) || parsed.success !== false) {
    return undefined;
  }

  if (typeof parsed.errorMessage === 'string') return parsed.errorMessage;
  if (typeof parsed.error === 'string') return parsed.error;
  return 'Tool returned success=false';
}

function getFailedStatusMessage(content: string): string | undefined {
  const unwrapped = unwrapTextContent(content);
  const parsed = parseJson(unwrapped);

  if (isRecord(parsed)) {
    if (typeof parsed.errorMessage === 'string') return parsed.errorMessage;
    if (typeof parsed.error === 'string') return parsed.error;
  }

  return unwrapped.trim() || undefined;
}

export function normalizeToolEventMetadata(
  metadata: Metadata | undefined,
  content: string,
): Metadata | undefined {
  if (!metadata || metadata.agentEventType !== 'tool_result') {
    return metadata;
  }

  const failedStatus =
    metadata.status === 'failed' ||
    metadata.status === 'cancelled' ||
    metadata.status === 'timeout';
  const failureMessage =
    typeof metadata.errorMessage === 'string'
      ? metadata.errorMessage
      : failedStatus
        ? getFailedStatusMessage(content)
        : getExplicitFailureMessage(content);
  const success =
    metadata.success === false || failedStatus || failureMessage ? false : true;
  const status =
    success || failedStatus ? (metadata.status ?? 'completed') : 'failed';

  return {
    ...metadata,
    status,
    success,
    completedAt:
      typeof metadata.completedAt === 'string'
        ? metadata.completedAt
        : new Date().toISOString(),
    ...(!success && failureMessage ? { errorMessage: failureMessage } : {}),
  };
}

type Metadata = Record<string, unknown>;

function normalizeAgentEventType(value: unknown): string | undefined {
  if (value === 'func_call' || value === 'function_call') {
    return 'tool_call';
  }
  if (value === 'func_result' || value === 'function_result') {
    return 'tool_result';
  }
  return typeof value === 'string' ? value : undefined;
}

function normalizeAgentEventStatus(
  value: unknown,
  rawAgentEventType: unknown,
): string | undefined {
  if (typeof value === 'string') return value;
  if (
    rawAgentEventType === 'func_call' ||
    rawAgentEventType === 'function_call'
  ) {
    return 'running';
  }
  if (
    rawAgentEventType === 'func_result' ||
    rawAgentEventType === 'function_result'
  ) {
    return 'completed';
  }
  return undefined;
}

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

function getToolRuntimeFailureMessage(content: string): string | undefined {
  const unwrapped = unwrapTextContent(content).trim();
  if (/^tool not found:/i.test(unwrapped)) {
    return unwrapped;
  }
  return undefined;
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
  if (!metadata) {
    return metadata;
  }

  const rawAgentEventType = metadata.agentEventType;
  const agentEventType = normalizeAgentEventType(rawAgentEventType);
  const normalizedStatus = normalizeAgentEventStatus(
    metadata.status,
    rawAgentEventType,
  );
  const normalizedMetadata =
    agentEventType && agentEventType !== metadata.agentEventType
      ? {
          ...metadata,
          agentEventType,
          ...(normalizedStatus ? { status: normalizedStatus } : {}),
        }
      : metadata;

  if (normalizedMetadata.agentEventType !== 'tool_result') {
    return normalizedMetadata;
  }

  const failedStatus =
    normalizedMetadata.status === 'failed' ||
    normalizedMetadata.status === 'cancelled' ||
    normalizedMetadata.status === 'timeout';
  const inferredFailureMessage =
    getExplicitFailureMessage(content) ?? getToolRuntimeFailureMessage(content);
  const failureMessage =
    typeof normalizedMetadata.errorMessage === 'string'
      ? normalizedMetadata.errorMessage
      : failedStatus
        ? getFailedStatusMessage(content)
        : inferredFailureMessage;
  const success =
    normalizedMetadata.success === false || failedStatus || failureMessage
      ? false
      : true;
  const status =
    success || failedStatus
      ? (normalizedMetadata.status ?? 'completed')
      : 'failed';

  return {
    ...normalizedMetadata,
    status,
    success,
    completedAt:
      typeof normalizedMetadata.completedAt === 'string'
        ? normalizedMetadata.completedAt
        : new Date().toISOString(),
    ...(!success && failureMessage ? { errorMessage: failureMessage } : {}),
  };
}

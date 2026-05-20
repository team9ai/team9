import { REDIS_KEYS } from '../shared/constants/redis-keys.js';

export const STREAM_TTL = 120;
export const LONG_RUNNING_STREAM_TTL = 90 * 60;
export const STREAMING_FINALIZED_TTL = 300;

export interface StreamingSessionSnapshot {
  channelId: string;
  senderId: string;
  parentId?: string;
  metadata?: Record<string, unknown>;
  startedAt: number;
  content?: string;
  thinking?: string;
}

export interface ActiveStreamingSessionDto {
  streamId: string;
  channelId: string;
  senderId: string;
  parentId?: string;
  metadata?: Record<string, unknown>;
  startedAt: number;
  content: string;
  thinking: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function hasDeepResearchMetadata(
  metadata: Record<string, unknown> | undefined,
): boolean {
  return isRecord(metadata?.deepResearch);
}

export function hasLongRunningStreamingMetadata(
  metadata: Record<string, unknown> | undefined,
): boolean {
  return metadata?.longRunning === true || hasDeepResearchMetadata(metadata);
}

export function resolveStreamingSessionTtl(
  metadata: Record<string, unknown> | undefined,
): number {
  return hasLongRunningStreamingMetadata(metadata)
    ? LONG_RUNNING_STREAM_TTL
    : STREAM_TTL;
}

export function parseStreamingSessionSnapshot(
  sessionRaw: string | null,
): StreamingSessionSnapshot | null {
  if (!sessionRaw) return null;
  try {
    const parsed = JSON.parse(sessionRaw) as Partial<StreamingSessionSnapshot>;
    if (
      typeof parsed.channelId !== 'string' ||
      typeof parsed.senderId !== 'string' ||
      typeof parsed.startedAt !== 'number'
    ) {
      return null;
    }
    return {
      channelId: parsed.channelId,
      senderId: parsed.senderId,
      parentId:
        typeof parsed.parentId === 'string' ? parsed.parentId : undefined,
      metadata: isRecord(parsed.metadata) ? parsed.metadata : undefined,
      startedAt: parsed.startedAt,
      content: typeof parsed.content === 'string' ? parsed.content : undefined,
      thinking:
        typeof parsed.thinking === 'string' ? parsed.thinking : undefined,
    };
  } catch {
    return null;
  }
}

export function toActiveStreamingSessionDto(
  streamId: string,
  session: StreamingSessionSnapshot,
): ActiveStreamingSessionDto {
  return {
    streamId,
    channelId: session.channelId,
    senderId: session.senderId,
    parentId: session.parentId,
    metadata: session.metadata,
    startedAt: session.startedAt,
    content: session.content ?? '',
    thinking: session.thinking ?? '',
  };
}

export function getStreamIdFromStreamingSessionKey(key: string): string | null {
  const prefix = REDIS_KEYS.STREAMING_SESSION('');
  if (!key.startsWith(prefix)) return null;
  const streamId = key.slice(prefix.length);
  if (
    !streamId ||
    streamId.startsWith('bot:') ||
    streamId.startsWith('finalized:')
  ) {
    return null;
  }
  return streamId;
}

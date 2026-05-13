export const AGENT_TIMELINE_EVENT_TYPE = 'agent_timeline_event' as const;
export const AGENT_TIMELINE_SCHEMA = 'team9.agent.timeline.v1' as const;

export type AgentTimelineEventTypeV1 = typeof AGENT_TIMELINE_EVENT_TYPE;
export type AgentTimelineSchemaV1 = typeof AGENT_TIMELINE_SCHEMA;

export type AgentTimelineOpV1 = 'start' | 'patch' | 'end' | 'abort';

export type AgentTimelineKindV1 =
  | 'response'
  | 'tool_call'
  | 'execution_marker'
  | 'error'
  | 'a2ui';

export type AgentTimelineStatusV1 =
  | 'running'
  | 'completed'
  | 'failed'
  | 'aborted';

export interface TimelineAttachmentV1 {
  id?: string;
  fileName: string;
  mimeType?: string;
  url?: string;
  size?: number;
}

export interface ResponseThinkingSnapshotV1 {
  text: string;
  redacted?: boolean;
  startedAt?: string;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface ResponseSnapshotV1 {
  role: 'assistant';
  text: string;
  thinking?: ResponseThinkingSnapshotV1;
  attachments?: TimelineAttachmentV1[];
}

export interface ToolCallSnapshotV1 {
  toolCallId: string;
  toolName: string;
  args?: unknown;
  argsText?: string;
  result?: unknown;
  resultPreview?: string;
  isError?: boolean;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  jobId?: string;
  state?: string;
}

export interface ExecutionMarkerSnapshotV1 {
  marker:
    | 'agent_start'
    | 'agent_end'
    | 'turn_start'
    | 'turn_end'
    | 'round_start'
    | 'round_end';
  label: string;
  durationMs?: number;
}

export interface ErrorSnapshotV1 {
  message: string;
  code?: string;
  details?: unknown;
}

export interface A2UISnapshotV1 {
  surfaceId: string;
  payload: unknown;
  metadata?: Record<string, unknown>;
  parentItemId?: string;
  toolCallId?: string;
}

export type AgentTimelineSnapshotV1 =
  | ResponseSnapshotV1
  | ToolCallSnapshotV1
  | ExecutionMarkerSnapshotV1
  | ErrorSnapshotV1
  | A2UISnapshotV1;

export type AgentTimelineDeltaV1 =
  | {
      op: 'append_text';
      path: '/text' | '/thinking/text' | '/argsText' | '/resultPreview';
      text: string;
    }
  | {
      op: 'merge';
      path: '';
      value: Record<string, unknown>;
    }
  | {
      op: 'replace';
      path: string;
      value: unknown;
    };

export type AgentTimelinePatchV1 =
  | {
      mode: 'delta';
      baseSeq: number;
      delta: AgentTimelineDeltaV1;
    }
  | {
      mode: 'checkpoint';
      checkpointSeq: number;
      snapshot: AgentTimelineSnapshotV1;
    }
  | {
      mode: 'final';
      snapshot: AgentTimelineSnapshotV1;
    };

export interface AgentTimelineIdPartsV1 {
  channelId: string;
  sessionId: string;
  turnIndex: number;
}

export interface AgentTurnIdPartsV1 {
  sessionId: string;
  turnIndex: number;
}

export interface AgentTimelineEventV1 {
  type: AgentTimelineEventTypeV1;
  schema: AgentTimelineSchemaV1;
  timelineId: string;
  eventId: string;
  seq: number;
  sessionId: string;
  channelId: string;
  turnId: string;
  turnIndex: number;
  itemId: string;
  parentItemId?: string;
  parentMessageId?: string;
  op: AgentTimelineOpV1;
  kind: AgentTimelineKindV1;
  status: AgentTimelineStatusV1;
  phase?: string;
  patch: AgentTimelinePatchV1;
}

export type AgentTimelineAckCodeV1 =
  | 'STALE_SEQ'
  | 'SEQ_GAP'
  | 'IDEMPOTENCY_CONFLICT'
  | 'SCHEMA_VERSION_UNSUPPORTED'
  | 'FORBIDDEN'
  | 'TRANSIENT_FAILURE';

export interface AgentTimelineAckV1 {
  ok: boolean;
  timelineId: string;
  eventId: string;
  seq: number;
  lastAppliedSeq: number;
  code?: AgentTimelineAckCodeV1;
  retryable?: boolean;
}

export interface AgentTimelineStateV1 {
  lastAppliedSeq: number;
  events: Record<string, AgentTimelineEventV1>;
  materializedItems: Record<string, AgentTimelineSnapshotV1>;
  finalItems: Record<string, AgentTimelineSnapshotV1>;
}

export function makeAgentTimelineId({
  channelId,
  sessionId,
  turnIndex,
}: AgentTimelineIdPartsV1): string {
  return `${channelId}:${makeAgentTurnId({ sessionId, turnIndex })}`;
}

export function makeAgentTurnId({
  sessionId,
  turnIndex,
}: AgentTurnIdPartsV1): string {
  return `${sessionId}#turn:${turnIndex}`;
}

export function makeAgentTimelineEventId(
  timelineId: string,
  seq: number,
): string {
  return `${timelineId}:${seq}`;
}

export function isAgentTimelineEventV1(
  value: unknown,
): value is AgentTimelineEventV1 {
  if (!isRecord(value)) return false;
  if ('snapshot' in value) return false;
  if (!isAgentTimelineKind(value['kind'])) return false;

  return (
    value['type'] === AGENT_TIMELINE_EVENT_TYPE &&
    value['schema'] === AGENT_TIMELINE_SCHEMA &&
    isNonEmptyString(value['timelineId']) &&
    isNonEmptyString(value['eventId']) &&
    isPositiveInteger(value['seq']) &&
    isNonEmptyString(value['sessionId']) &&
    isNonEmptyString(value['channelId']) &&
    isNonEmptyString(value['turnId']) &&
    isNonNegativeInteger(value['turnIndex']) &&
    value['turnId'] ===
      makeAgentTurnId({
        sessionId: value['sessionId'],
        turnIndex: value['turnIndex'],
      }) &&
    value['timelineId'] ===
      makeAgentTimelineId({
        channelId: value['channelId'],
        sessionId: value['sessionId'],
        turnIndex: value['turnIndex'],
      }) &&
    value['eventId'] ===
      makeAgentTimelineEventId(value['timelineId'], value['seq']) &&
    isNonEmptyString(value['itemId']) &&
    (value['parentItemId'] === undefined ||
      isNonEmptyString(value['parentItemId'])) &&
    (value['parentMessageId'] === undefined ||
      isNonEmptyString(value['parentMessageId'])) &&
    isAgentTimelineOp(value['op']) &&
    isAgentTimelineStatus(value['status']) &&
    (value['phase'] === undefined || typeof value['phase'] === 'string') &&
    isAgentTimelineOpPatchPair(value['op'], value['patch']) &&
    isAgentTimelinePatchV1(value['patch'], value['kind'])
  );
}

function isAgentTimelineOpPatchPair(
  op: AgentTimelineOpV1,
  patch: unknown,
): boolean {
  if (!isRecord(patch)) return false;
  if (op === 'end') return patch['mode'] === 'final';
  return patch['mode'] !== 'final';
}

function isAgentTimelinePatchV1(
  value: unknown,
  kind: AgentTimelineKindV1,
): value is AgentTimelinePatchV1 {
  if (!isRecord(value)) return false;

  switch (value['mode']) {
    case 'delta':
      return (
        isNonNegativeInteger(value['baseSeq']) &&
        isAgentTimelineDeltaV1(value['delta'])
      );
    case 'checkpoint':
      return (
        isNonNegativeInteger(value['checkpointSeq']) &&
        isAgentTimelineSnapshotV1(value['snapshot'], kind)
      );
    case 'final':
      return isAgentTimelineSnapshotV1(value['snapshot'], kind);
    default:
      return false;
  }
}

function isAgentTimelineDeltaV1(value: unknown): value is AgentTimelineDeltaV1 {
  if (!isRecord(value)) return false;

  switch (value['op']) {
    case 'append_text':
      return (
        isAppendTextPath(value['path']) && typeof value['text'] === 'string'
      );
    case 'merge':
      return value['path'] === '' && isRecord(value['value']);
    case 'replace':
      return isNonEmptyString(value['path']) && 'value' in value;
    default:
      return false;
  }
}

function isAgentTimelineSnapshotV1(
  value: unknown,
  kind: AgentTimelineKindV1,
): value is AgentTimelineSnapshotV1 {
  if (!isRecord(value)) return false;

  switch (kind) {
    case 'response':
      return isResponseSnapshotV1(value);
    case 'tool_call':
      return isToolCallSnapshotV1(value);
    case 'execution_marker':
      return isExecutionMarkerSnapshotV1(value);
    case 'error':
      return isErrorSnapshotV1(value);
    case 'a2ui':
      return isA2UISnapshotV1(value);
  }
}

function isResponseSnapshotV1(value: Record<string, unknown>): boolean {
  return (
    value['role'] === 'assistant' &&
    typeof value['text'] === 'string' &&
    (value['thinking'] === undefined ||
      (isRecord(value['thinking']) &&
        typeof value['thinking']['text'] === 'string')) &&
    (value['attachments'] === undefined ||
      (Array.isArray(value['attachments']) &&
        value['attachments'].every(
          (attachment) =>
            isRecord(attachment) && typeof attachment['fileName'] === 'string',
        )))
  );
}

function isToolCallSnapshotV1(value: Record<string, unknown>): boolean {
  return (
    typeof value['toolCallId'] === 'string' &&
    typeof value['toolName'] === 'string'
  );
}

function isExecutionMarkerSnapshotV1(value: Record<string, unknown>): boolean {
  return (
    isExecutionMarker(value['marker']) && typeof value['label'] === 'string'
  );
}

function isErrorSnapshotV1(value: Record<string, unknown>): boolean {
  return typeof value['message'] === 'string';
}

function isA2UISnapshotV1(value: Record<string, unknown>): boolean {
  return typeof value['surfaceId'] === 'string' && 'payload' in value;
}

function isExecutionMarker(value: unknown): boolean {
  return (
    value === 'agent_start' ||
    value === 'agent_end' ||
    value === 'turn_start' ||
    value === 'turn_end' ||
    value === 'round_start' ||
    value === 'round_end'
  );
}

function isAgentTimelineOp(value: unknown): value is AgentTimelineOpV1 {
  return (
    value === 'start' ||
    value === 'patch' ||
    value === 'end' ||
    value === 'abort'
  );
}

function isAgentTimelineKind(value: unknown): value is AgentTimelineKindV1 {
  return (
    value === 'response' ||
    value === 'tool_call' ||
    value === 'execution_marker' ||
    value === 'error' ||
    value === 'a2ui'
  );
}

function isAgentTimelineStatus(value: unknown): value is AgentTimelineStatusV1 {
  return (
    value === 'running' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'aborted'
  );
}

function isAppendTextPath(
  value: unknown,
): value is AgentTimelineDeltaV1['path'] {
  return (
    value === '/text' ||
    value === '/thinking/text' ||
    value === '/argsText' ||
    value === '/resultPreview'
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

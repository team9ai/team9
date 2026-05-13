import { Injectable } from '@nestjs/common';
import { RedisService } from '@team9/redis';
import {
  isAgentTimelineEventV1,
  type AgentTimelineAckCodeV1,
  type AgentTimelineAckV1,
  type AgentTimelineDeltaV1,
  type AgentTimelineEventV1,
  type AgentTimelineSnapshotV1,
  type AgentTimelineStateV1,
} from '@team9/shared';

const KEY_PREFIX = 'im:agent_timeline:';
const TIMELINE_TTL_SECONDS = 60 * 60 * 24;

type StoredAgentTimelineStateV1 = AgentTimelineStateV1 & {
  materializedItemSeqs: Record<string, number>;
};

interface ApplyResult {
  ack: AgentTimelineAckV1;
  nextState?: StoredAgentTimelineStateV1;
}

class TimelineStateParseError extends Error {}

@Injectable()
export class AgentTimelineService {
  constructor(private readonly redisService: RedisService) {}

  async applyEvent(event: unknown): Promise<AgentTimelineAckV1> {
    if (!isAgentTimelineEventV1(event)) {
      return this.makeRejectedAck(event, 'SCHEMA_VERSION_UNSUPPORTED', false);
    }

    try {
      const atomicAck = await this.applyEventAtomically(event);
      if (atomicAck) return atomicAck;
    } catch (error) {
      if (error instanceof TimelineStateParseError) {
        return this.makeRejectedAck(event, 'TRANSIENT_FAILURE', true);
      }
      throw error;
    }

    try {
      const state = await this.loadState(event.timelineId);
      const result = this.computeApplyResult(state, event);
      if (result.nextState) {
        await this.saveState(result.nextState, event.timelineId);
      }
      return result.ack;
    } catch (error) {
      if (error instanceof TimelineStateParseError) {
        return this.makeRejectedAck(event, 'TRANSIENT_FAILURE', true);
      }
      throw error;
    }
  }

  private computeApplyResult(
    state: StoredAgentTimelineStateV1,
    event: AgentTimelineEventV1,
  ): ApplyResult {
    const existingEvent = state.events[event.eventId];
    if (existingEvent) {
      if (stableStringify(existingEvent) === stableStringify(event)) {
        return {
          ack: {
            ok: true,
            eventId: event.eventId,
            timelineId: event.timelineId,
            seq: event.seq,
            lastAppliedSeq: state.lastAppliedSeq,
            code: 'STALE_SEQ',
          },
        };
      }

      return {
        ack: {
          ok: false,
          eventId: event.eventId,
          timelineId: event.timelineId,
          seq: event.seq,
          lastAppliedSeq: state.lastAppliedSeq,
          code: 'IDEMPOTENCY_CONFLICT',
          retryable: false,
        },
      };
    }

    if (event.seq <= state.lastAppliedSeq) {
      return {
        ack: {
          ok: false,
          eventId: event.eventId,
          timelineId: event.timelineId,
          seq: event.seq,
          lastAppliedSeq: state.lastAppliedSeq,
          code: 'IDEMPOTENCY_CONFLICT',
          retryable: false,
        },
      };
    }

    if (event.seq !== state.lastAppliedSeq + 1) {
      return {
        ack: {
          ok: false,
          eventId: event.eventId,
          timelineId: event.timelineId,
          seq: event.seq,
          lastAppliedSeq: state.lastAppliedSeq,
          code: 'SEQ_GAP',
          retryable: true,
        },
      };
    }

    if (isDeltaBaseSeqMismatch(state, event)) {
      return {
        ack: {
          ok: false,
          eventId: event.eventId,
          timelineId: event.timelineId,
          seq: event.seq,
          lastAppliedSeq: state.lastAppliedSeq,
          code: 'SEQ_GAP',
          retryable: true,
        },
      };
    }

    const nextState = this.applyToState(state, event);
    return {
      ack: {
        ok: true,
        eventId: event.eventId,
        timelineId: event.timelineId,
        seq: event.seq,
        lastAppliedSeq: event.seq,
      },
      nextState,
    };
  }

  makeRejectedAck(
    event: unknown,
    code: AgentTimelineAckCodeV1,
    retryable: boolean,
  ): AgentTimelineAckV1 {
    return {
      ok: false,
      eventId: getStringField(event, 'eventId') ?? '',
      timelineId: getStringField(event, 'timelineId') ?? '',
      seq: getNumberField(event, 'seq') ?? -1,
      lastAppliedSeq: -1,
      code,
      retryable,
    };
  }

  async getTimelineState(
    timelineId: string,
  ): Promise<AgentTimelineStateV1 | null> {
    const stateRaw = await this.redisService.get(this.getKey(timelineId));
    if (!stateRaw) return null;
    return this.parseStoredState(stateRaw);
  }

  private async loadState(
    timelineId: string,
  ): Promise<StoredAgentTimelineStateV1> {
    const state = await this.getTimelineState(timelineId);
    if (!state) return this.createEmptyState();

    return this.normalizeStoredState(state);
  }

  private normalizeStoredState(
    state: AgentTimelineStateV1,
  ): StoredAgentTimelineStateV1 {
    return {
      ...state,
      materializedItemSeqs:
        getMaterializedItemSeqs(state) ??
        inferMaterializedItemSeqsFromEvents(state),
    };
  }

  private async applyEventAtomically(
    event: AgentTimelineEventV1,
  ): Promise<AgentTimelineAckV1 | null> {
    const client = this.getRedisClient();
    if (!client) return null;

    const key = this.getKey(event.timelineId);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const stateRaw = await client.get(key);
      const state = stateRaw
        ? this.parseStoredState(stateRaw)
        : this.createEmptyState();
      const result = this.computeApplyResult(
        this.normalizeStoredState(state),
        event,
      );

      if (!result.nextState) {
        return result.ack;
      }

      const applyResult = await client.eval(
        `
local current = redis.call('get', KEYS[1])
local expected = ARGV[1]
if expected == '__TEAM9_TIMELINE_NULL__' then
  if current ~= false then
    return 0
  end
elseif current ~= expected then
  return 0
end
redis.call('set', KEYS[1], ARGV[2], 'EX', ARGV[3])
return 1
        `,
        1,
        key,
        stateRaw ?? '__TEAM9_TIMELINE_NULL__',
        JSON.stringify(result.nextState),
        TIMELINE_TTL_SECONDS.toString(),
      );

      if (applyResult === 1) {
        return result.ack;
      }
    }

    return this.makeRejectedAck(event, 'TRANSIENT_FAILURE', true);
  }

  private async saveState(
    state: StoredAgentTimelineStateV1,
    timelineId: string,
  ): Promise<void> {
    await this.redisService.set(
      this.getKey(timelineId),
      JSON.stringify(state),
      TIMELINE_TTL_SECONDS,
    );
  }

  private createEmptyState(): StoredAgentTimelineStateV1 {
    return {
      lastAppliedSeq: 0,
      events: {},
      materializedItems: {},
      materializedItemSeqs: {},
      finalItems: {},
    };
  }

  private applyToState(
    state: StoredAgentTimelineStateV1,
    event: AgentTimelineEventV1,
  ): StoredAgentTimelineStateV1 {
    const nextState: StoredAgentTimelineStateV1 = {
      lastAppliedSeq: event.seq,
      events: {
        ...state.events,
        [event.eventId]: event,
      },
      materializedItems: { ...state.materializedItems },
      materializedItemSeqs: { ...state.materializedItemSeqs },
      finalItems: { ...state.finalItems },
    };

    if (event.op === 'end' && event.patch.mode === 'final') {
      nextState.materializedItems[event.itemId] = event.patch.snapshot;
      nextState.materializedItemSeqs[event.itemId] = event.seq;
      nextState.finalItems[event.itemId] = event.patch.snapshot;
      return nextState;
    }

    if (event.patch.mode === 'checkpoint') {
      nextState.materializedItems[event.itemId] = event.patch.snapshot;
      nextState.materializedItemSeqs[event.itemId] = event.seq;
      return nextState;
    }

    if (event.patch.mode === 'delta') {
      const currentItemSeq = nextState.materializedItemSeqs[event.itemId] ?? 0;
      if (event.patch.baseSeq !== currentItemSeq) {
        return nextState;
      }

      nextState.materializedItems[event.itemId] = applyDelta(
        nextState.materializedItems[event.itemId],
        event.patch.delta,
      );
      nextState.materializedItemSeqs[event.itemId] = event.seq;
    }

    return nextState;
  }

  private getKey(timelineId: string): string {
    return `${KEY_PREFIX}${timelineId}`;
  }

  private getRedisClient(): ReturnType<RedisService['getClient']> | null {
    const maybeRedisService = this.redisService as RedisService & {
      getClient?: () => ReturnType<RedisService['getClient']>;
    };
    if (typeof maybeRedisService.getClient !== 'function') return null;
    return maybeRedisService.getClient();
  }

  private parseStoredState(stateRaw: string): AgentTimelineStateV1 {
    try {
      const parsed = JSON.parse(stateRaw) as unknown;
      if (!isStoredTimelineShape(parsed)) {
        throw new TimelineStateParseError('Invalid agent timeline state');
      }
      return parsed;
    } catch (error) {
      if (error instanceof TimelineStateParseError) throw error;
      throw new TimelineStateParseError('Malformed agent timeline state');
    }
  }
}

function applyDelta(
  current: AgentTimelineSnapshotV1 | undefined,
  delta: AgentTimelineDeltaV1,
): AgentTimelineSnapshotV1 {
  const next =
    current && typeof current === 'object' ? structuredClone(current) : {};

  switch (delta.op) {
    case 'append_text':
      appendStringPath(next, delta.path, delta.text);
      return next as AgentTimelineSnapshotV1;
    case 'merge':
      return {
        ...next,
        ...delta.value,
      } as AgentTimelineSnapshotV1;
    case 'replace':
      replaceJsonPointer(next, delta.path, delta.value);
      return next as AgentTimelineSnapshotV1;
  }
}

function appendStringPath(
  target: Record<string, unknown>,
  path: AgentTimelineDeltaV1['path'],
  text: string,
): void {
  if (path === '/thinking/text') {
    const thinking = isRecord(target.thinking)
      ? { ...target.thinking }
      : { text: '' };
    thinking.text = `${typeof thinking.text === 'string' ? thinking.text : ''}${text}`;
    target.thinking = thinking;
    return;
  }

  const property = path.slice(1);
  target[property] =
    `${typeof target[property] === 'string' ? target[property] : ''}${text}`;
}

function replaceJsonPointer(
  target: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const parts = path
    .split('/')
    .slice(1)
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
  if (parts.length === 0) return;

  let current = target;
  for (const part of parts.slice(0, -1)) {
    const next = current[part];
    if (!isRecord(next)) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  current[parts[parts.length - 1]] = value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (!isRecord(value)) {
    return value;
  }

  return Object.keys(value)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = sortJson(value[key]);
      return acc;
    }, {});
}

function getStringField(value: unknown, field: string): string | undefined {
  return isRecord(value) && typeof value[field] === 'string'
    ? value[field]
    : undefined;
}

function getNumberField(value: unknown, field: string): number | undefined {
  return isRecord(value) && typeof value[field] === 'number'
    ? value[field]
    : undefined;
}

function getMaterializedItemSeqs(
  state: AgentTimelineStateV1,
): Record<string, number> | undefined {
  const value = (state as { materializedItemSeqs?: unknown })
    .materializedItemSeqs;
  if (!isRecord(value)) return undefined;

  return Object.entries(value).reduce<Record<string, number>>(
    (acc, [itemId, seq]) => {
      if (typeof seq === 'number' && Number.isInteger(seq) && seq >= 0) {
        acc[itemId] = seq;
      }
      return acc;
    },
    {},
  );
}

function inferMaterializedItemSeqsFromEvents(
  state: AgentTimelineStateV1,
): Record<string, number> {
  return Object.values(state.events).reduce<Record<string, number>>(
    (acc, event) => {
      if (
        isAgentTimelineEventV1(event) &&
        event.itemId in state.materializedItems
      ) {
        acc[event.itemId] = Math.max(acc[event.itemId] ?? 0, event.seq);
      }
      return acc;
    },
    {},
  );
}

function isDeltaBaseSeqMismatch(
  state: StoredAgentTimelineStateV1,
  event: AgentTimelineEventV1,
): boolean {
  if (event.patch.mode !== 'delta') return false;
  const currentItemSeq = state.materializedItemSeqs[event.itemId] ?? 0;
  return event.patch.baseSeq !== currentItemSeq;
}

function isStoredTimelineShape(value: unknown): value is AgentTimelineStateV1 {
  return (
    isRecord(value) &&
    typeof value.lastAppliedSeq === 'number' &&
    Number.isInteger(value.lastAppliedSeq) &&
    isRecord(value.events) &&
    isRecord(value.materializedItems) &&
    isRecord(value.finalItems)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

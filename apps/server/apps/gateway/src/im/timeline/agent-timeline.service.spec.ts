import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { AgentTimelineService } from './agent-timeline.service.js';
import type { AgentTimelineEventV1, AgentTimelineStateV1 } from '@team9/shared';

class RedisServiceStub {
  readonly values = new Map<string, string>();

  get = jest.fn(async (key: string) => this.values.get(key) ?? null);

  set = jest.fn(async (key: string, value: string, _ttlSeconds?: number) => {
    this.values.set(key, value);
    return 'OK' as const;
  });

  eval = jest.fn(
    async (
      _script: string,
      _keyCount: number,
      key: string,
      expected: string,
      nextValue: string,
    ) => {
      const current = this.values.get(key) ?? null;
      if (expected === '__TEAM9_TIMELINE_NULL__') {
        if (current !== null) return 0;
      } else if (current !== expected) {
        return 0;
      }

      this.values.set(key, nextValue);
      return 1;
    },
  );

  getClient = jest.fn(() => ({
    get: this.get,
    eval: this.eval,
  }));
}

const TIMELINE_ID = 'channel-1:session-1#turn:0';

function makeEvent(
  overrides: Partial<AgentTimelineEventV1> = {},
): AgentTimelineEventV1 {
  const seq = overrides.seq ?? 1;

  return {
    type: 'agent_timeline_event',
    schema: 'team9.agent.timeline.v1',
    timelineId: TIMELINE_ID,
    eventId: `${TIMELINE_ID}:${seq}`,
    seq,
    sessionId: 'session-1',
    channelId: 'channel-1',
    turnId: 'session-1#turn:0',
    turnIndex: 0,
    itemId: 'response-1',
    op: 'patch',
    kind: 'response',
    status: 'running',
    patch: {
      mode: 'checkpoint',
      checkpointSeq: seq,
      snapshot: {
        role: 'assistant',
        text: 'hello',
      },
    },
    ...overrides,
  };
}

describe('AgentTimelineService', () => {
  let redisService: RedisServiceStub;
  let service: AgentTimelineService;

  beforeEach(() => {
    redisService = new RedisServiceStub();
    service = new AgentTimelineService(redisService as never);
  });

  it('stores delta and checkpoint events as materializedItems but not finalItems', async () => {
    const delta = makeEvent({
      seq: 1,
      eventId: `${TIMELINE_ID}:1`,
      patch: {
        mode: 'delta',
        baseSeq: 0,
        delta: {
          op: 'append_text',
          path: '/text',
          text: 'hel',
        },
      },
    });
    const checkpoint = makeEvent({
      seq: 2,
      eventId: `${TIMELINE_ID}:2`,
      patch: {
        mode: 'checkpoint',
        checkpointSeq: 2,
        snapshot: {
          role: 'assistant',
          text: 'hello',
        },
      },
    });

    await service.applyEvent(delta);
    const ack = await service.applyEvent(checkpoint);
    const state = (await service.getTimelineState(
      TIMELINE_ID,
    )) as AgentTimelineStateV1;

    expect(ack).toEqual({
      ok: true,
      eventId: checkpoint.eventId,
      timelineId: TIMELINE_ID,
      seq: 2,
      lastAppliedSeq: 2,
    });
    expect(state.materializedItems).toEqual({
      'response-1': {
        role: 'assistant',
        text: 'hello',
      },
    });
    expect(state.finalItems).toEqual({});
  });

  it('writes finalItems only for end events with a final patch', async () => {
    const finalEvent = makeEvent({
      seq: 1,
      op: 'end',
      status: 'completed',
      patch: {
        mode: 'final',
        snapshot: {
          role: 'assistant',
          text: 'done',
        },
      },
    });

    const ack = await service.applyEvent(finalEvent);
    const state = (await service.getTimelineState(
      TIMELINE_ID,
    )) as AgentTimelineStateV1;

    expect(ack.ok).toBe(true);
    expect(state.materializedItems).toEqual({
      'response-1': {
        role: 'assistant',
        text: 'done',
      },
    });
    expect(state.finalItems).toEqual({
      'response-1': {
        role: 'assistant',
        text: 'done',
      },
    });
  });

  it('returns STALE_SEQ for idempotent replay of an already applied event', async () => {
    const event = makeEvent({ seq: 1 });

    await service.applyEvent(event);
    const replayAck = await service.applyEvent(event);

    expect(replayAck).toEqual({
      ok: true,
      eventId: event.eventId,
      timelineId: TIMELINE_ID,
      seq: 1,
      lastAppliedSeq: 1,
      code: 'STALE_SEQ',
    });
  });

  it('returns IDEMPOTENCY_CONFLICT for the same eventId with a different payload', async () => {
    const event = makeEvent({ seq: 1 });
    const conflictingEvent = makeEvent({
      seq: 1,
      eventId: event.eventId,
      patch: {
        mode: 'checkpoint',
        checkpointSeq: 1,
        snapshot: {
          role: 'assistant',
          text: 'different',
        },
      },
    });

    await service.applyEvent(event);
    const ack = await service.applyEvent(conflictingEvent);

    expect(ack).toEqual({
      ok: false,
      eventId: event.eventId,
      timelineId: TIMELINE_ID,
      seq: 1,
      lastAppliedSeq: 1,
      code: 'IDEMPOTENCY_CONFLICT',
      retryable: false,
    });
  });

  it('returns retryable SEQ_GAP when seq skips the next expected value', async () => {
    const ack = await service.applyEvent(makeEvent({ seq: 2 }));

    expect(ack).toEqual({
      ok: false,
      eventId: `${TIMELINE_ID}:2`,
      timelineId: TIMELINE_ID,
      seq: 2,
      lastAppliedSeq: 0,
      code: 'SEQ_GAP',
      retryable: true,
    });
  });

  it('returns SCHEMA_VERSION_UNSUPPORTED for invalid event shapes', async () => {
    const invalidEvent = {
      ...makeEvent({ seq: 1 }),
      schema: 'team9.agent.timeline.v2',
    };

    const ack = await service.applyEvent(invalidEvent);

    expect(ack).toEqual({
      ok: false,
      eventId: `${TIMELINE_ID}:1`,
      timelineId: TIMELINE_ID,
      seq: 1,
      lastAppliedSeq: -1,
      code: 'SCHEMA_VERSION_UNSUPPORTED',
      retryable: false,
    });
  });

  it('returns SCHEMA_VERSION_UNSUPPORTED for seq zero', async () => {
    const invalidEvent = {
      ...makeEvent({ seq: 0 }),
      eventId: `${TIMELINE_ID}:0`,
    };

    const ack = await service.applyEvent(invalidEvent);

    expect(ack).toEqual({
      ok: false,
      eventId: `${TIMELINE_ID}:0`,
      timelineId: TIMELINE_ID,
      seq: 0,
      lastAppliedSeq: -1,
      code: 'SCHEMA_VERSION_UNSUPPORTED',
      retryable: false,
    });
  });

  it('returns SCHEMA_VERSION_UNSUPPORTED when event ids do not match the derived timeline identity', async () => {
    const invalidEvent = {
      ...makeEvent({ seq: 1 }),
      timelineId: 'other-channel:session-1#turn:0',
    };

    const ack = await service.applyEvent(invalidEvent);

    expect(ack).toEqual({
      ok: false,
      eventId: `${TIMELINE_ID}:1`,
      timelineId: 'other-channel:session-1#turn:0',
      seq: 1,
      lastAppliedSeq: -1,
      code: 'SCHEMA_VERSION_UNSUPPORTED',
      retryable: false,
    });
  });

  it('returns SCHEMA_VERSION_UNSUPPORTED for final patches that are not end events', async () => {
    const invalidEvent = makeEvent({
      seq: 1,
      op: 'patch',
      patch: {
        mode: 'final',
        snapshot: {
          role: 'assistant',
          text: 'not terminal',
        },
      },
    });

    const ack = await service.applyEvent(invalidEvent);

    expect(ack).toEqual({
      ok: false,
      eventId: `${TIMELINE_ID}:1`,
      timelineId: TIMELINE_ID,
      seq: 1,
      lastAppliedSeq: -1,
      code: 'SCHEMA_VERSION_UNSUPPORTED',
      retryable: false,
    });
  });

  it('returns retryable TRANSIENT_FAILURE when stored Redis state is malformed', async () => {
    redisService.values.set(`im:agent_timeline:${TIMELINE_ID}`, 'not-json');

    const ack = await service.applyEvent(makeEvent({ seq: 1 }));

    expect(ack).toEqual({
      ok: false,
      eventId: `${TIMELINE_ID}:1`,
      timelineId: TIMELINE_ID,
      seq: 1,
      lastAppliedSeq: -1,
      code: 'TRANSIENT_FAILURE',
      retryable: true,
    });
  });

  it('rejects a delta when baseSeq does not match the current item state', async () => {
    const initialDelta = makeEvent({
      seq: 1,
      eventId: `${TIMELINE_ID}:1`,
      patch: {
        mode: 'delta',
        baseSeq: 0,
        delta: {
          op: 'append_text',
          path: '/text',
          text: 'hello',
        },
      },
    });
    const staleDelta = makeEvent({
      seq: 2,
      eventId: `${TIMELINE_ID}:2`,
      patch: {
        mode: 'delta',
        baseSeq: 99,
        delta: {
          op: 'append_text',
          path: '/text',
          text: ' stale',
        },
      },
    });

    await service.applyEvent(initialDelta);
    const ack = await service.applyEvent(staleDelta);
    const state = (await service.getTimelineState(
      TIMELINE_ID,
    )) as AgentTimelineStateV1;

    expect(ack).toEqual({
      ok: false,
      eventId: staleDelta.eventId,
      timelineId: TIMELINE_ID,
      seq: 2,
      lastAppliedSeq: 1,
      code: 'SEQ_GAP',
      retryable: true,
    });
    expect(state.lastAppliedSeq).toBe(1);
    expect(state.materializedItems).toEqual({
      'response-1': {
        text: 'hello',
      },
    });
    expect(state.finalItems).toEqual({});
  });

  it('rejects stale events when no identical stored payload exists', async () => {
    redisService.values.set(
      `im:agent_timeline:${TIMELINE_ID}`,
      JSON.stringify({
        lastAppliedSeq: 1,
        events: {},
        materializedItems: {},
        finalItems: {},
      }),
    );
    const staleEvent = makeEvent({
      seq: 1,
      eventId: `${TIMELINE_ID}:1`,
    });
    const ack = await service.applyEvent(staleEvent);

    expect(ack).toEqual({
      ok: false,
      eventId: staleEvent.eventId,
      timelineId: TIMELINE_ID,
      seq: 1,
      lastAppliedSeq: 1,
      code: 'IDEMPOTENCY_CONFLICT',
      retryable: false,
    });
  });
});

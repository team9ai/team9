import { describe, expect, it } from '@jest/globals';
import {
  filterAgentSessionEvent,
  projectSafeComponents,
  redactSensitiveValue,
} from './agent-session-redaction.js';

describe('agent session redaction', () => {
  it('redacts sensitive object keys recursively', () => {
    expect(
      redactSensitiveValue({
        token: 'abc',
        nested: { apiKey: 'def', keep: 'visible' },
        list: [{ password: 'ghi' }, { ok: true }],
      }),
    ).toEqual({
      token: '[redacted]',
      nested: { apiKey: '[redacted]', keep: 'visible' },
      list: [{ password: '[redacted]' }, { ok: true }],
    });
  });

  it('strips component configs and keeps redacted latest data', () => {
    expect(
      projectSafeComponents({
        sessionId: 's1',
        components: [
          {
            id: 'persona',
            typeKey: 'persona',
            declaredConfig: { token: 'secret' },
            effectiveConfig: { token: 'secret' },
            runtimeInjectedOnly: false,
            latestData: {
              data: { mood: 'calm', credential: 'raw' },
              capturedAtCallId: 'call-1',
              capturedAt: 123,
            },
          },
        ],
      }),
    ).toEqual({
      sessionId: 's1',
      components: [
        {
          id: 'persona',
          typeKey: 'persona',
          runtimeInjectedOnly: false,
          latestData: {
            data: { mood: 'calm', credential: '[redacted]' },
            capturedAtCallId: 'call-1',
            capturedAt: 123,
          },
        },
      ],
    });
  });

  it('allows component snapshots after redacting payload data', () => {
    expect(
      filterAgentSessionEvent({
        type: 'component_data_snapshot',
        sessionId: 's1',
        timestamp: 456,
        turnIndex: 1,
        components: [
          { componentId: 'host', data: { authorization: 'Bearer x' } },
        ],
      }),
    ).toEqual({
      type: 'component_data_snapshot',
      sessionId: 's1',
      timestamp: 456,
      turnIndex: 1,
      components: [
        { componentId: 'host', data: { authorization: '[redacted]' } },
      ],
    });
  });

  it('drops non-allowlisted events', () => {
    expect(
      filterAgentSessionEvent({
        type: 'tool_execution_start',
        sessionId: 's1',
        timestamp: 1,
        args: { token: 'raw' },
      }),
    ).toBeNull();
  });
});

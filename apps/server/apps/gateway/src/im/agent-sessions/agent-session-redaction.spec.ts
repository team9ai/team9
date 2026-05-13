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

  it('redacts camelCase secret keys', () => {
    expect(
      redactSensitiveValue({
        accessToken: 'access-token',
        clientSecret: 'client-secret',
        team9AuthToken: { value: 'nested-token' },
        keep: { value: 'visible' },
      }),
    ).toEqual({
      accessToken: '[redacted]',
      clientSecret: '[redacted]',
      team9AuthToken: '[redacted]',
      keep: { value: 'visible' },
    });
  });

  it('keeps redacted component configs and latest data', () => {
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
              token: 'raw-latest-token',
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
          declaredConfig: { token: '[redacted]' },
          effectiveConfig: { token: '[redacted]' },
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
        token: 'raw-event-token',
        components: [
          {
            componentId: 'host',
            token: 'raw-component-token',
            effectiveConfig: { apiKey: 'raw' },
            data: { authorization: 'Bearer x' },
          },
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

  it('keeps valid JSON component snapshot values that are not plain objects', () => {
    expect(
      filterAgentSessionEvent({
        type: 'component_data_snapshot',
        sessionId: 's1',
        timestamp: 456,
        turnIndex: 1,
        components: [
          { componentId: 'list', data: [{ token: 'raw' }, 'visible'] },
          { componentId: 'empty', data: null },
          { componentId: 'flag', data: false },
          { componentId: 'count', data: 0 },
        ],
      }),
    ).toEqual({
      type: 'component_data_snapshot',
      sessionId: 's1',
      timestamp: 456,
      turnIndex: 1,
      components: [
        { componentId: 'list', data: [{ token: '[redacted]' }, 'visible'] },
        { componentId: 'empty', data: null },
        { componentId: 'flag', data: false },
        { componentId: 'count', data: 0 },
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

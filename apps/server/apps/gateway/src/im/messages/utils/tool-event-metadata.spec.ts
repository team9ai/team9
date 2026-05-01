import { normalizeToolEventMetadata } from './tool-event-metadata.js';

describe('normalizeToolEventMetadata', () => {
  it('sets success false when a completed tool_result content has success false', () => {
    const result = normalizeToolEventMetadata(
      {
        agentEventType: 'tool_result',
        status: 'completed',
        toolCallId: 'tc-1',
      },
      '{"success":false,"error":"denied"}',
    );

    expect(result).toMatchObject({
      agentEventType: 'tool_result',
      status: 'failed',
      success: false,
      errorMessage: 'denied',
    });
  });

  it('sets success false for failed status without changing toolCallId', () => {
    const result = normalizeToolEventMetadata(
      {
        agentEventType: 'tool_result',
        status: 'failed',
        toolCallId: 'tc-2',
      },
      'permission denied',
    );

    expect(result).toMatchObject({
      status: 'failed',
      success: false,
      toolCallId: 'tc-2',
      errorMessage: 'permission denied',
    });
  });

  it('sets success false when a completed tool_result returns a tool-not-found text error', () => {
    const result = normalizeToolEventMetadata(
      {
        agentEventType: 'tool_result',
        status: 'completed',
        toolCallId: 'tc-not-found',
      },
      'tool not found: completeRoutine. Use search_tools to find available tools.',
    );

    expect(result).toMatchObject({
      agentEventType: 'tool_result',
      status: 'failed',
      success: false,
      toolCallId: 'tc-not-found',
      errorMessage:
        'tool not found: completeRoutine. Use search_tools to find available tools.',
    });
  });

  it('sets success true for completed tool_result with no failure evidence', () => {
    const result = normalizeToolEventMetadata(
      {
        agentEventType: 'tool_result',
        status: 'completed',
        toolCallId: 'tc-3',
      },
      '{"success":true}',
    );

    expect(result).toMatchObject({
      status: 'completed',
      success: true,
      toolCallId: 'tc-3',
    });
  });

  it('preserves timeout status while marking the result unsuccessful', () => {
    const result = normalizeToolEventMetadata(
      {
        agentEventType: 'tool_result',
        status: 'timeout',
        toolCallId: 'tc-timeout',
      },
      'tool timed out',
    );

    expect(result).toMatchObject({
      status: 'timeout',
      success: false,
      toolCallId: 'tc-timeout',
      errorMessage: 'tool timed out',
    });
  });

  it('unwraps text blocks before inferring legacy failure payloads', () => {
    const result = normalizeToolEventMetadata(
      {
        agentEventType: 'tool_result',
        status: 'completed',
        toolCallId: 'tc-4',
      },
      JSON.stringify({
        content: [{ type: 'text', text: '{"success":false,"error":"bad"}' }],
      }),
    );

    expect(result).toMatchObject({
      status: 'failed',
      success: false,
      errorMessage: 'bad',
    });
  });

  it('returns non-tool metadata unchanged', () => {
    const metadata = { agentEventType: 'thinking', status: 'completed' };
    expect(normalizeToolEventMetadata(metadata, 'x')).toBe(metadata);
  });
});

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

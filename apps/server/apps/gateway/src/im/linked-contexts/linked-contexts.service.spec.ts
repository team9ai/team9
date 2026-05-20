import { describe, expect, it } from '@jest/globals';

import { LinkedContextsService } from './linked-contexts.service.js';

function makeMessage(id: string, content: string, createdAt: Date) {
  return {
    id,
    channelId: 'child-1',
    senderId: null,
    sender: null,
    content,
    createdAt,
    metadata: null,
  } as any;
}

describe('LinkedContextsService', () => {
  function service() {
    return new LinkedContextsService(null as any, null as any, null as any);
  }

  it('prioritizes recent child-channel messages when content is truncated', () => {
    const target = service() as any;
    const normalizeMessages = target.normalizeMessages.bind(target) as (
      messages: any[],
      maxContentChars: number,
    ) => { messages: Array<{ id: string; content: string; truncated?: true }> };
    const messages = [
      makeMessage('plan', 'p'.repeat(40), new Date('2026-01-01T00:00:00Z')),
      makeMessage('report', 'r'.repeat(200), new Date('2026-01-01T00:01:00Z')),
      makeMessage('follow-up', 'follow up', new Date('2026-01-01T00:02:00Z')),
      makeMessage('answer', 'answer', new Date('2026-01-01T00:03:00Z')),
    ];

    const result = normalizeMessages(messages, 40);

    expect(result.messages.map((message) => message.id)).toEqual([
      'report',
      'follow-up',
      'answer',
    ]);
    expect(result.messages[0]?.content).toHaveLength(25);
    expect(result.messages[0]?.truncated).toBe(true);
    expect(result.messages[1]?.content).toBe('follow up');
    expect(result.messages[2]?.content).toBe('answer');
  });

  it('keeps chronological order when no truncation is needed', () => {
    const target = service() as any;
    const normalizeMessages = target.normalizeMessages.bind(target) as (
      messages: any[],
      maxContentChars: number,
    ) => {
      messages: Array<{ id: string }>;
    };
    const messages = [
      makeMessage('plan', 'plan', new Date('2026-01-01T00:00:00Z')),
      makeMessage('report', 'report', new Date('2026-01-01T00:01:00Z')),
      makeMessage('follow-up', 'follow-up', new Date('2026-01-01T00:02:00Z')),
    ];

    const result = normalizeMessages(messages, 100);

    expect(result.messages.map((message) => message.id)).toEqual([
      'plan',
      'report',
      'follow-up',
    ]);
  });
});

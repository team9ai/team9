import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { Team9StyleQueryParser } from './team9-style-query.parser.js';

describe('Team9StyleQueryParser', () => {
  const parser = new Team9StyleQueryParser();

  afterEach(() => {
    jest.useRealTimers();
  });

  it('parses explicit from, in, before, after, has, is, and type filters while cleaning text', () => {
    const result = parser.parse(
      '  from:@alice from:bob in:#general in:random before:2024-01-01 after:2024-02-02 has:file has:reaction is:pinned is:thread type:message type:file  hello   team9  ',
    );

    expect(result).toEqual({
      text: 'hello team9',
      filters: {
        from: ['alice', 'bob'],
        in: ['general', 'random'],
        before: new Date('2024-01-01'),
        after: new Date('2024-02-02'),
        has: ['file', 'reaction'],
        is: ['pinned', 'thread'],
        type: ['message', 'file'],
      },
    });
  });

  it('uses during to calculate after and override an explicit after filter', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-06-15T12:34:56.000Z'));

    const result = parser.parse('during:week after:2024-02-02 follow up');

    expect(result.text).toBe('follow up');
    expect(result.filters.during).toBe('week');
    expect(result.filters.after?.toISOString()).toBe(
      '2024-06-08T12:34:56.000Z',
    );
  });

  it('ignores invalid dates and still removes the tokens from text', () => {
    const result = parser.parse('before:2024-13-01 after:2024-99-99 keep me');

    expect(result.text).toBe('keep me');
    expect(result.filters.before).toBeUndefined();
    expect(result.filters.after).toBeUndefined();
  });
});

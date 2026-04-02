import { describe, expect, it } from '@jest/globals';
import {
  extractMentionedUserIds,
  hasBroadcastMention,
  parseMentions,
} from './mention-parser.js';

describe('mention-parser', () => {
  it('parses everyone, here, user, and channel mentions with positions', () => {
    const content =
      'Ping @everyone and @here plus @<123e4567-e89b-12d3-a456-426614174000> in #<123e4567-e89b-12d3-a456-426614174001>';

    const mentions = parseMentions(content);

    expect(mentions).toEqual([
      {
        type: 'everyone',
        originalText: '@everyone',
        startIndex: 5,
        endIndex: 14,
      },
      {
        type: 'here',
        originalText: '@here',
        startIndex: 19,
        endIndex: 24,
      },
      {
        type: 'user',
        userId: '123e4567-e89b-12d3-a456-426614174000',
        originalText: '@<123e4567-e89b-12d3-a456-426614174000>',
        startIndex: 30,
        endIndex: 69,
      },
      {
        type: 'channel',
        channelId: '123e4567-e89b-12d3-a456-426614174001',
        originalText: '#<123e4567-e89b-12d3-a456-426614174001>',
        startIndex: 73,
        endIndex: 112,
      },
    ]);
  });

  it('extracts unique user ids only from user mentions', () => {
    const mentions = parseMentions(
      '@everyone @<123e4567-e89b-12d3-a456-426614174000> @<123e4567-e89b-12d3-a456-426614174000> #<123e4567-e89b-12d3-a456-426614174001>',
    );

    expect(extractMentionedUserIds(mentions)).toEqual([
      '123e4567-e89b-12d3-a456-426614174000',
    ]);
  });

  it('reports whether everyone or here broadcast mentions are present', () => {
    const mentions = parseMentions('hello @here team');

    expect(hasBroadcastMention(mentions)).toEqual({
      everyone: false,
      here: true,
    });
    expect(hasBroadcastMention([])).toEqual({
      everyone: false,
      here: false,
    });
  });
});

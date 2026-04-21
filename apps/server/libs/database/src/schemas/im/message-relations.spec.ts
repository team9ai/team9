import { describe, it, expect } from '@jest/globals';
import { messageRelations, relationKindEnum } from './message-relations.js';

describe('message-relations schema', () => {
  it('defines relation_kind enum with parent and related', () => {
    expect(relationKindEnum.enumValues).toEqual(['parent', 'related']);
  });

  it('exposes expected columns on im_message_relations', () => {
    const cols = Object.keys(messageRelations);
    expect(cols).toEqual(
      expect.arrayContaining([
        'id',
        'tenantId',
        'channelId',
        'sourceMessageId',
        'targetMessageId',
        'propertyDefinitionId',
        'relationKind',
        'createdBy',
        'createdAt',
      ]),
    );
  });
});

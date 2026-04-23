import { describe, it, expect } from '@jest/globals';
import {
  DEFAULT_MESSAGE_REF_CONFIG,
  type MessageRefConfig,
} from './property.types.js';

describe('MessageRefConfig', () => {
  it('defaults are backward-compatible with legacy message_ref', () => {
    expect(DEFAULT_MESSAGE_REF_CONFIG).toEqual({
      scope: 'any',
      cardinality: 'multi',
    });
    expect(DEFAULT_MESSAGE_REF_CONFIG.relationKind).toBeUndefined();
  });

  it('accepts a same-channel parent shortcut config', () => {
    const config: MessageRefConfig = {
      scope: 'same_channel',
      cardinality: 'single',
      relationKind: 'parent',
    };
    expect(config.relationKind).toBe('parent');
  });
});

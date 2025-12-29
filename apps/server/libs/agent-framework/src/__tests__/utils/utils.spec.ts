/**
 * Unit tests for utils module
 */
import {
  generateId,
  generateChunkId,
  generateStateId,
  generateThreadId,
  extractIdPrefix,
  IdPrefix,
} from '../../utils/index.js';

describe('Utils Module', () => {
  describe('generateId', () => {
    it('should generate a string id with prefix', () => {
      const id = generateId(IdPrefix.CHUNK);
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
      expect(id.startsWith('chunk_')).toBe(true);
    });

    it('should generate unique ids', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateId(IdPrefix.CHUNK));
      }
      expect(ids.size).toBe(100);
    });
  });

  describe('Specific ID generators', () => {
    it('should generate chunk id with chunk prefix', () => {
      const id = generateChunkId();
      expect(id.startsWith('chunk_')).toBe(true);
    });

    it('should generate state id with state prefix', () => {
      const id = generateStateId();
      expect(id.startsWith('state_')).toBe(true);
    });

    it('should generate thread id with thread prefix', () => {
      const id = generateThreadId();
      expect(id.startsWith('thread_')).toBe(true);
    });
  });

  describe('extractIdPrefix', () => {
    it('should extract valid prefix from id', () => {
      const chunkId = generateChunkId();
      const prefix = extractIdPrefix(chunkId);
      expect(prefix).toBe(IdPrefix.CHUNK);
    });

    it('should return null for id with invalid prefix', () => {
      const prefix = extractIdPrefix('invalid_abc123');
      expect(prefix).toBeNull();
    });

    it('should return null for id without underscore', () => {
      const prefix = extractIdPrefix('noprefixhere');
      expect(prefix).toBeNull();
    });
  });
});

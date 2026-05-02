import { jest } from '@jest/globals';

const { SpellIdService } = await import('../spell-id.service.js');
const { SPELL_WORDS } = await import('../spell-words.js');

describe('SpellIdService', () => {
  describe('SPELL_WORDS', () => {
    it('contains exactly 2048 lowercase words', () => {
      expect(SPELL_WORDS).toHaveLength(2048);
      for (const w of SPELL_WORDS) {
        expect(w).toMatch(/^[a-z]+$/);
      }
    });
  });

  describe('generate()', () => {
    it('returns a 3-word lowercase string by default', () => {
      const svc = new SpellIdService();
      const id = svc.generate();
      expect(id).toMatch(/^[a-z]+( [a-z]+){2}$/);
      const words = id.split(' ');
      expect(new Set(words).size).toBe(3); // distinct
    });

    it('respects wordCount=4', () => {
      const svc = new SpellIdService();
      const id = svc.generate({ wordCount: 4 });
      expect(id.split(' ')).toHaveLength(4);
    });

    it('uses the injected RNG deterministically', () => {
      const fakeRng = jest.fn<() => number>();
      // Pick indices 0, 1, 2 for three calls
      fakeRng
        .mockReturnValueOnce(0)
        .mockReturnValueOnce(1 / 2048)
        .mockReturnValueOnce(2 / 2048);
      const svc = new SpellIdService(fakeRng);
      const id = svc.generate({ wordCount: 3 });
      expect(id).toBe(`${SPELL_WORDS[0]} ${SPELL_WORDS[1]} ${SPELL_WORDS[2]}`);
    });

    it('rerolls duplicate words within one id', () => {
      const fakeRng = jest.fn<() => number>();
      // First three calls all pick index 0; algorithm must reroll until distinct.
      fakeRng
        .mockReturnValueOnce(0)
        .mockReturnValueOnce(0)
        .mockReturnValueOnce(1 / 2048)
        .mockReturnValueOnce(0)
        .mockReturnValueOnce(2 / 2048);
      const svc = new SpellIdService(fakeRng);
      const id = svc.generate({ wordCount: 3 });
      const words = id.split(' ');
      expect(new Set(words).size).toBe(3);
    });
  });

  describe('parse()', () => {
    it('normalizes whitespace and case', () => {
      const svc = new SpellIdService();
      expect(svc.parse('  Raven   crystal  Flame  ')).toBe(
        'raven crystal flame',
      );
    });

    it('rejects fewer than 3 words', () => {
      const svc = new SpellIdService();
      expect(svc.parse('hello world')).toBeNull();
    });

    it('rejects more than 4 words', () => {
      const svc = new SpellIdService();
      expect(svc.parse('a b c d e')).toBeNull();
    });

    it('rejects non-letter characters', () => {
      const svc = new SpellIdService();
      expect(svc.parse('raven crystal flame!')).toBeNull();
      expect(svc.parse('raven 123 flame')).toBeNull();
    });
  });
});

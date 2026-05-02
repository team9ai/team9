import { Injectable } from '@nestjs/common';
import { SPELL_WORDS } from './spell-words.js';

export type RandomFn = () => number; // returns [0, 1)

@Injectable()
export class SpellIdService {
  constructor(private readonly rng: RandomFn = Math.random) {}

  generate(opts: { wordCount?: 3 | 4 } = {}): string {
    const count = opts.wordCount ?? 3;
    const picked: string[] = [];
    while (picked.length < count) {
      const idx = Math.floor(this.rng() * SPELL_WORDS.length);
      const word = SPELL_WORDS[idx];
      if (!picked.includes(word)) picked.push(word);
    }
    return picked.join(' ');
  }

  parse(input: string): string | null {
    const normalized = input.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!/^[a-z]+( [a-z]+){2,3}$/.test(normalized)) return null;
    return normalized;
  }
}

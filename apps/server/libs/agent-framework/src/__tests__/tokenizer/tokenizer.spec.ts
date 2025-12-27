/**
 * Unit tests for tokenizer module
 */
import {
  createTokenizer,
  TiktokenTokenizer,
  SimpleTokenizer,
  getEncodingForModel,
} from '../../tokenizer/index.js';

describe('Tokenizer Module', () => {
  describe('SimpleTokenizer', () => {
    it('should count tokens using char/4 approximation', () => {
      const tokenizer = new SimpleTokenizer();
      const text = 'Hello, world!'; // 13 chars

      const count = tokenizer.countTokens(text);

      const expected = Math.ceil(13 / 4);
      expect(count).toBe(expected);
    });

    it('should return 0 for empty string', () => {
      const tokenizer = new SimpleTokenizer();
      const count = tokenizer.countTokens('');

      expect(count).toBe(0);
    });

    it('should encode and decode', () => {
      const tokenizer = new SimpleTokenizer();
      const text = 'TestText'; // 8 chars, 4 chars/token = 2 tokens

      const encoded = tokenizer.encode(text);

      expect(encoded.length).toBe(2);

      const decoded = tokenizer.decode(encoded);
      expect(decoded).toContain('2 tokens');
    });
  });

  describe('TiktokenTokenizer', () => {
    it('should count tokens', () => {
      const tokenizer = new TiktokenTokenizer('cl100k_base');
      const text = 'Hello, world!';

      const count = tokenizer.countTokens(text);

      expect(count).toBeGreaterThan(0);
    });

    it('should encode text', () => {
      const tokenizer = new TiktokenTokenizer('cl100k_base');
      const text = 'Hello';

      const tokens = tokenizer.encode(text);

      expect(Array.isArray(tokens)).toBe(true);
      expect(tokens.length).toBeGreaterThan(0);
    });

    it('should decode tokens', () => {
      const tokenizer = new TiktokenTokenizer('cl100k_base');
      const text = 'Hello, world!';

      const tokens = tokenizer.encode(text);
      const decoded = tokenizer.decode(tokens);

      expect(decoded).toBe(text);
    });
  });

  describe('createTokenizer Factory', () => {
    it('should create tokenizer for gpt-4o', () => {
      const tokenizer = createTokenizer('gpt-4o');
      const count = tokenizer.countTokens('Hello');

      expect(count).toBeGreaterThan(0);
    });

    it('should create tokenizer for gpt-4', () => {
      const tokenizer = createTokenizer('gpt-4');
      const count = tokenizer.countTokens('Hello');

      expect(count).toBeGreaterThan(0);
    });

    it('should create tokenizer for claude-3-5-sonnet', () => {
      const tokenizer = createTokenizer('claude-3-5-sonnet-20241022');
      const count = tokenizer.countTokens('Hello');

      expect(count).toBeGreaterThan(0);
    });

    it('should cache tokenizers', () => {
      const tokenizer1 = createTokenizer('gpt-4o');
      const tokenizer2 = createTokenizer('gpt-4o');

      expect(tokenizer1).toBe(tokenizer2);
    });

    it('should handle different models', () => {
      const gpt4oTokenizer = createTokenizer('gpt-4o');
      const gpt4Tokenizer = createTokenizer('gpt-4');

      const count1 = gpt4oTokenizer.countTokens('Test string for comparison');
      const count2 = gpt4Tokenizer.countTokens('Test string for comparison');

      expect(count1).toBeGreaterThan(0);
      expect(count2).toBeGreaterThan(0);
    });
  });

  describe('getEncodingForModel', () => {
    it('should return correct encodings for known models', () => {
      const cases = [
        { model: 'gpt-4o', expected: 'o200k_base' },
        { model: 'gpt-4o-mini', expected: 'o200k_base' },
        { model: 'gpt-4', expected: 'cl100k_base' },
        { model: 'gpt-4-turbo', expected: 'cl100k_base' },
        { model: 'gpt-3.5-turbo', expected: 'cl100k_base' },
        { model: 'claude-3-opus', expected: 'cl100k_base' },
        { model: 'text-embedding-ada-002', expected: 'cl100k_base' },
      ];

      for (const { model, expected } of cases) {
        const encoding = getEncodingForModel(model);
        expect(encoding).toBe(expected);
      }
    });

    it('should fallback to cl100k_base for unknown model', () => {
      const encoding = getEncodingForModel('unknown-model-xyz');

      expect(encoding).toBe('cl100k_base');
    });
  });

  describe('Edge Cases', () => {
    it('should handle long text', () => {
      const tokenizer = createTokenizer('gpt-4o');
      const longText = 'This is a test sentence. '.repeat(100);

      const count = tokenizer.countTokens(longText);

      expect(count).toBeGreaterThan(0);
    });

    it('should handle special characters', () => {
      const tokenizer = createTokenizer('gpt-4o');
      const specialText = '你好世界 🌍 <script>alert("test")</script>';

      const count = tokenizer.countTokens(specialText);

      expect(count).toBeGreaterThan(0);
    });

    it('should handle code snippets', () => {
      const tokenizer = createTokenizer('gpt-4o');
      const code = `
function hello() {
  console.log("Hello, world!");
  return { status: "ok" };
}
`;

      const count = tokenizer.countTokens(code);

      expect(count).toBeGreaterThan(0);
    });
  });
});

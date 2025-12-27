import {
  getEncoding,
  encodingForModel,
  Tiktoken,
  TiktokenEncoding,
} from 'js-tiktoken';
import {
  ITokenizer,
  TokenizerEncoding,
  getEncodingForModel,
} from './tokenizer.types';

/**
 * Tiktoken-based tokenizer implementation
 * Provides accurate token counting for OpenAI models
 */
export class TiktokenTokenizer implements ITokenizer {
  private tiktoken: Tiktoken;
  private modelName: string;

  constructor(model: string) {
    this.modelName = model;
    const encoding = getEncodingForModel(model);
    this.tiktoken = getEncoding(encoding as TiktokenEncoding);
  }

  countTokens(text: string): number {
    return this.tiktoken.encode(text).length;
  }

  encode(text: string): number[] {
    return this.tiktoken.encode(text);
  }

  decode(tokens: number[]): string {
    return this.tiktoken.decode(tokens);
  }

  getModelName(): string {
    return this.modelName;
  }
}

/**
 * Simple character-based tokenizer (fallback)
 * Uses ~4 characters per token approximation
 */
export class SimpleTokenizer implements ITokenizer {
  private modelName: string;
  private charsPerToken: number;

  constructor(model: string = 'unknown', charsPerToken: number = 4) {
    this.modelName = model;
    this.charsPerToken = charsPerToken;
  }

  countTokens(text: string): number {
    return Math.ceil(text.length / this.charsPerToken);
  }

  encode(text: string): number[] {
    // Simple encoding: split by chars-per-token chunks
    const tokens: number[] = [];
    for (let i = 0; i < text.length; i += this.charsPerToken) {
      // Use a simple hash for the token ID
      const chunk = text.slice(i, i + this.charsPerToken);
      tokens.push(this.simpleHash(chunk));
    }
    return tokens;
  }

  decode(tokens: number[]): string {
    // Cannot decode with simple tokenizer
    return `[${tokens.length} tokens]`;
  }

  getModelName(): string {
    return this.modelName;
  }

  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }
}

// Cache for tokenizers by model name
const tokenizerCache = new Map<string, ITokenizer>();

/**
 * Create or get a cached tokenizer for the given model
 */
export function createTokenizer(model: string): ITokenizer {
  // Check cache
  const cached = tokenizerCache.get(model);
  if (cached) {
    return cached;
  }

  // Create new tokenizer
  let tokenizer: ITokenizer;
  try {
    tokenizer = new TiktokenTokenizer(model);
  } catch {
    // Fallback to simple tokenizer if tiktoken fails
    console.warn(
      `Failed to create tiktoken tokenizer for model "${model}", using simple tokenizer`,
    );
    tokenizer = new SimpleTokenizer(model);
  }

  // Cache and return
  tokenizerCache.set(model, tokenizer);
  return tokenizer;
}

/**
 * Create a tokenizer for a specific encoding
 */
export function createTokenizerForEncoding(
  encoding: TokenizerEncoding,
): ITokenizer {
  const cacheKey = `encoding:${encoding}`;
  const cached = tokenizerCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const tiktoken = getEncoding(encoding as TiktokenEncoding);
  const tokenizer: ITokenizer = {
    countTokens: (text: string) => tiktoken.encode(text).length,
    encode: (text: string) => tiktoken.encode(text),
    decode: (tokens: number[]) => tiktoken.decode(tokens),
    getModelName: () => encoding,
  };

  tokenizerCache.set(cacheKey, tokenizer);
  return tokenizer;
}

/**
 * Clear the tokenizer cache
 */
export function clearTokenizerCache(): void {
  tokenizerCache.clear();
}

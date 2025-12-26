/**
 * Tokenizer interface for counting tokens
 */
export interface ITokenizer {
  /**
   * Count the number of tokens in a string
   */
  countTokens(text: string): number;

  /**
   * Encode text to token IDs
   */
  encode(text: string): number[];

  /**
   * Decode token IDs to text
   */
  decode(tokens: number[]): string;

  /**
   * Get the model name this tokenizer is for
   */
  getModelName(): string;
}

/**
 * Supported tokenizer encoding types
 */
export type TokenizerEncoding =
  | 'cl100k_base' // GPT-4, GPT-3.5-turbo, text-embedding-ada-002
  | 'p50k_base' // Codex models, text-davinci-002, text-davinci-003
  | 'p50k_edit' // text-davinci-edit-001, code-davinci-edit-001
  | 'r50k_base' // GPT-3 models (davinci, curie, babbage, ada)
  | 'o200k_base'; // GPT-4o, GPT-4o-mini

/**
 * Model to encoding mapping
 */
export const MODEL_ENCODING_MAP: Record<string, TokenizerEncoding> = {
  // GPT-4o family
  'gpt-4o': 'o200k_base',
  'gpt-4o-mini': 'o200k_base',
  'gpt-4.1': 'o200k_base',
  'gpt-4.1-mini': 'o200k_base',
  'gpt-4.1-nano': 'o200k_base',

  // GPT-4 family
  'gpt-4': 'cl100k_base',
  'gpt-4-turbo': 'cl100k_base',
  'gpt-4-32k': 'cl100k_base',

  // GPT-3.5 family
  'gpt-3.5-turbo': 'cl100k_base',
  'gpt-3.5-turbo-16k': 'cl100k_base',

  // o1/o3 family
  o1: 'o200k_base',
  'o1-mini': 'o200k_base',
  'o1-preview': 'o200k_base',
  o3: 'o200k_base',
  'o3-mini': 'o200k_base',

  // Claude (using cl100k_base as approximation)
  'claude-3-opus-20240229': 'cl100k_base',
  'claude-3-sonnet-20240229': 'cl100k_base',
  'claude-3-haiku-20240307': 'cl100k_base',
  'claude-3-5-sonnet-20240620': 'cl100k_base',
  'claude-3-5-sonnet-20241022': 'cl100k_base',
  'claude-3-5-haiku-20241022': 'cl100k_base',
  'claude-3-7-sonnet-20250219': 'cl100k_base',
  'claude-sonnet-4-20250514': 'cl100k_base',
  'claude-opus-4-20250514': 'cl100k_base',

  // Gemini (using cl100k_base as approximation)
  'gemini-pro': 'cl100k_base',
  'gemini-pro-1.5': 'cl100k_base',
  'gemini-2.0-flash': 'cl100k_base',
  'gemini-3-pro-preview': 'cl100k_base',
};

/**
 * Get the encoding type for a model
 */
export function getEncodingForModel(model: string): TokenizerEncoding {
  // Check exact match
  if (model in MODEL_ENCODING_MAP) {
    return MODEL_ENCODING_MAP[model];
  }

  // Check prefix match
  for (const [prefix, encoding] of Object.entries(MODEL_ENCODING_MAP)) {
    if (model.startsWith(prefix)) {
      return encoding;
    }
  }

  // Default to cl100k_base (most common)
  return 'cl100k_base';
}

# Tokenizer

This directory contains tokenizer implementations for accurate token counting.

## File Structure

| File                    | Description                                                          |
| ----------------------- | -------------------------------------------------------------------- |
| `tokenizer.types.ts`    | ITokenizer interface and model-encoding mappings                     |
| `tiktoken.tokenizer.ts` | TiktokenTokenizer (using js-tiktoken) and SimpleTokenizer (fallback) |

## ITokenizer Interface

```typescript
interface ITokenizer {
  countTokens(text: string): number;
  encode(text: string): number[];
  decode(tokens: number[]): string;
}
```

## Implementations

### TiktokenTokenizer

Accurate token counting using `js-tiktoken` library.

```typescript
import { createTokenizer } from '@team9/agent-runtime';

// Supports various models
const tokenizer = createTokenizer('gpt-4o'); // o200k_base encoding
const tokenizer = createTokenizer('gpt-4'); // cl100k_base encoding
const tokenizer = createTokenizer('gpt-3.5-turbo'); // cl100k_base encoding

// Claude models use cl100k_base as approximation
const tokenizer = createTokenizer('claude-3-5-sonnet-20241022');

const count = tokenizer.countTokens('Hello, world!');
```

### SimpleTokenizer

Fallback when no model-specific tokenizer is needed.

```typescript
import { SimpleTokenizer } from '@team9/agent-runtime';

const tokenizer = new SimpleTokenizer();
// Uses chars/4 approximation
```

## Model-Encoding Mapping

| Model               | Encoding                    |
| ------------------- | --------------------------- |
| gpt-4o, gpt-4o-mini | o200k_base                  |
| gpt-4, gpt-4-turbo  | cl100k_base                 |
| gpt-3.5-turbo       | cl100k_base                 |
| claude-\*           | cl100k_base (approximation) |
| text-embedding-\*   | cl100k_base                 |

## Caching

`createTokenizer()` caches tokenizer instances by model name for efficiency:

```typescript
const t1 = createTokenizer('gpt-4o');
const t2 = createTokenizer('gpt-4o');
// t1 === t2 (same instance)
```

## Modification Notice

When modifying files in this directory, please update this CLAUDE.md accordingly. Changes may affect:

- Token counting accuracy
- Context Builder token limits
- Compaction trigger thresholds

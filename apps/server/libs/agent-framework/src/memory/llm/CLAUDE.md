# LLM Integration

This directory contains LLM adapter interfaces for Memory system components (primarily Compactor).

## File Structure

| File           | Description                             |
| -------------- | --------------------------------------- |
| `llm.types.ts` | ILLMAdapter interface and related types |

## ILLMAdapter Interface

```typescript
interface ILLMAdapter {
  complete(request: LLMCompletionRequest): Promise<LLMCompletionResponse>;
}

interface LLMCompletionRequest {
  messages: LLMMessage[];
  temperature?: number;
  maxTokens?: number;
}

interface LLMCompletionResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}
```

## Usage

Used by Compactors to call LLM for summarization:

```typescript
class WorkingFlowCompactor implements ICompactor {
  constructor(private llmAdapter: ILLMAdapter) {}

  async compact(chunks: MemoryChunk[]): Promise<MemoryChunk> {
    const response = await this.llmAdapter.complete({
      messages: [{ role: 'user', content: prompt }],
    });
    // Create summary chunk from response
  }
}
```

## Implementing ILLMAdapter

To integrate with your LLM provider:

```typescript
import { IAIProviderAdapter } from '@team9/ai-client';

class AIClientLLMAdapter implements ILLMAdapter {
  constructor(private aiProvider: IAIProviderAdapter) {}

  async complete(
    request: LLMCompletionRequest,
  ): Promise<LLMCompletionResponse> {
    const result = await this.aiProvider.complete(request);
    return { content: result.text, usage: result.usage };
  }
}
```

## Modification Notice

When modifying files in this directory, please update this CLAUDE.md accordingly. LLM interface changes affect:

- Compactor implementations
- Any future LLM-dependent components

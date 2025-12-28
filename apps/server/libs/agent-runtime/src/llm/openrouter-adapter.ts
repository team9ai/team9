import type {
  ILLMAdapter,
  LLMCompletionRequest,
  LLMCompletionResponse,
  LLMToolCall,
} from '@team9/agent-framework';

export interface OpenRouterConfig {
  apiKey: string;
  model: string;
  referer?: string;
  title?: string;
}

/**
 * OpenRouter LLM Adapter
 * Implements ILLMAdapter interface using OpenRouter API
 */
export class OpenRouterAdapter implements ILLMAdapter {
  private baseUrl = 'https://openrouter.ai/api/v1/chat/completions';
  private config: OpenRouterConfig;

  constructor(config: OpenRouterConfig) {
    this.config = config;
  }

  async complete(
    request: LLMCompletionRequest,
  ): Promise<LLMCompletionResponse> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.config.apiKey}`,
    };

    if (this.config.referer) {
      headers['HTTP-Referer'] = this.config.referer;
    }
    if (this.config.title) {
      headers['X-Title'] = this.config.title;
    }

    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: request.messages.map((msg) => {
        if (msg.role === 'tool') {
          return {
            role: 'tool',
            content: msg.content,
            tool_call_id: msg.toolCallId,
          };
        }
        return {
          role: msg.role,
          content: msg.content,
        };
      }),
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens ?? 4096,
    };

    // Add tools if provided
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }));
    }

    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(
          `OpenRouter API error: ${response.status} ${response.statusText} - ${errorData}`,
        );
      }

      const data = (await response.json()) as OpenRouterResponse;
      const choice = data.choices[0];

      // Parse tool calls if present
      let toolCalls: LLMToolCall[] | undefined;
      if (choice?.message?.tool_calls && choice.message.tool_calls.length > 0) {
        toolCalls = choice.message.tool_calls.map((tc) => ({
          id: tc.id,
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments || '{}'),
        }));
      }

      // Map finish reason
      let finishReason: LLMCompletionResponse['finishReason'];
      switch (choice?.finish_reason) {
        case 'stop':
          finishReason = 'stop';
          break;
        case 'tool_calls':
          finishReason = 'tool_calls';
          break;
        case 'length':
          finishReason = 'length';
          break;
        case 'content_filter':
          finishReason = 'content_filter';
          break;
      }

      return {
        content: choice?.message?.content || '',
        toolCalls,
        finishReason,
        usage: data.usage
          ? {
              promptTokens: data.usage.prompt_tokens,
              completionTokens: data.usage.completion_tokens,
              totalTokens: data.usage.total_tokens,
            }
          : undefined,
      };
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`OpenRouter request failed: ${String(error)}`);
    }
  }
}

interface OpenRouterToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenRouterResponse {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string | null;
      tool_calls?: OpenRouterToolCall[];
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Mock LLM Adapter for testing/demo purposes
 */
export class MockLLMAdapter implements ILLMAdapter {
  async complete(
    request: LLMCompletionRequest,
  ): Promise<LLMCompletionResponse> {
    // Return a mock response based on the last user message
    const lastUserMessage = request.messages
      .filter((m) => m.role === 'user')
      .pop();

    const mockContent = lastUserMessage
      ? `[Mock Response] Received your message: "${lastUserMessage.content.slice(0, 50)}..."`
      : '[Mock Response] Hello! This is a mock LLM response.';

    return {
      content: mockContent,
      usage: {
        promptTokens: Math.ceil(
          request.messages.reduce((acc, m) => acc + m.content.length, 0) / 4,
        ),
        completionTokens: Math.ceil(mockContent.length / 4),
        totalTokens:
          Math.ceil(
            request.messages.reduce((acc, m) => acc + m.content.length, 0) / 4,
          ) + Math.ceil(mockContent.length / 4),
      },
    };
  }
}

/**
 * Create an LLM adapter based on configuration
 */
export function createLLMAdapter(model: string, apiKey?: string): ILLMAdapter {
  // If no API key, use mock adapter
  if (!apiKey) {
    console.warn('No OPENROUTER_API_KEY provided, using mock LLM adapter');
    return new MockLLMAdapter();
  }

  return new OpenRouterAdapter({
    apiKey,
    model,
    referer: process.env.OPENROUTER_REFERER || 'http://localhost:3000',
    title: process.env.OPENROUTER_TITLE || 'Agent Debugger',
  });
}

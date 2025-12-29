import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import {
  IAIProviderAdapter,
  AICompletionRequest,
  AICompletionResponse,
  AIProvider,
  AIChatResponse,
} from '../interfaces/ai-provider.interface.js';
import { ConfigService as DbConfigService } from '@team9/database';

@Injectable()
export class ClaudeProvider implements IAIProviderAdapter {
  private readonly logger = new Logger(ClaudeProvider.name);
  private client: Anthropic | null = null;

  constructor(private readonly configService: DbConfigService) {}

  private getClient(): Anthropic {
    if (!this.client) {
      const config = this.configService.getAIProviderConfig('claude');
      const apiKey = config.apiKey;

      if (!apiKey) {
        this.logger.warn(
          'CLAUDE_API_KEY is not configured in database or environment',
        );
      }

      this.client = new Anthropic({
        apiKey: apiKey || 'dummy-key',
      });
    }
    return this.client;
  }

  chat<T extends boolean | undefined = undefined>(
    request: AICompletionRequest & { stream?: T },
  ): AIChatResponse<T> {
    if (request.stream) {
      return this.streamChat(request) as AIChatResponse<T>;
    }
    return this.blockingChat(request) as AIChatResponse<T>;
  }

  private async blockingChat(
    request: AICompletionRequest,
  ): Promise<AICompletionResponse> {
    try {
      const systemMessage = request.messages.find((m) => m.role === 'system');
      const messages = request.messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }));

      const response = await this.getClient().messages.create({
        model: request.model,
        system: systemMessage?.content,
        messages,
        temperature: request.temperature ?? 0.7,
        max_tokens: request.maxTokens ?? 4096,
      });

      const content =
        response.content[0].type === 'text' ? response.content[0].text : '';

      return {
        provider: AIProvider.CLAUDE,
        model: request.model,
        content,
        usage: {
          promptTokens: response.usage.input_tokens,
          completionTokens: response.usage.output_tokens,
          totalTokens:
            response.usage.input_tokens + response.usage.output_tokens,
        },
        finishReason: response.stop_reason || undefined,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Claude completion error: ${errorMessage}`, errorStack);
      throw error;
    }
  }

  private async *streamChat(
    request: AICompletionRequest,
  ): AsyncGenerator<string> {
    try {
      const systemMessage = request.messages.find((m) => m.role === 'system');
      const messages = request.messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }));

      const stream = await this.getClient().messages.create({
        model: request.model,
        system: systemMessage?.content,
        messages,
        temperature: request.temperature ?? 0.7,
        max_tokens: request.maxTokens ?? 4096,
        stream: true,
      });

      for await (const chunk of stream) {
        if (
          chunk.type === 'content_block_delta' &&
          chunk.delta.type === 'text_delta'
        ) {
          yield chunk.delta.text;
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Claude stream error: ${errorMessage}`, errorStack);
      throw error;
    }
  }
}

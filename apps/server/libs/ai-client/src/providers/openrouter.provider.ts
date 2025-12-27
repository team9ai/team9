import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import {
  IAIProviderAdapter,
  AICompletionRequest,
  AICompletionResponse,
  AIProvider,
  AIChatResponse,
} from '../interfaces/ai-provider.interface.js';
import { ConfigService as DbConfigService } from '@team9/database';

@Injectable()
export class OpenRouterProvider implements IAIProviderAdapter {
  private readonly logger = new Logger(OpenRouterProvider.name);
  private client: OpenAI | null = null;

  constructor(private readonly configService: DbConfigService) {}

  private getClient(): OpenAI {
    if (!this.client) {
      const config = this.configService.getAIProviderConfig('openrouter');
      const apiKey = config.apiKey;

      if (!apiKey) {
        this.logger.warn(
          'OPENROUTER_API_KEY is not configured in database or environment',
        );
      }

      // OpenRouter uses OpenAI-compatible API
      this.client = new OpenAI({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: apiKey || 'dummy-key',
        defaultHeaders: {
          'HTTP-Referer': config.referer || '',
          'X-Title': config.title || 'AI Service',
        },
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
      const response = await this.getClient().chat.completions.create({
        model: request.model,
        messages: request.messages,
        temperature: request.temperature ?? 0.7,
        max_tokens: request.maxTokens,
      });

      const choice = response.choices[0];
      return {
        provider: AIProvider.OPENROUTER,
        model: request.model,
        content: choice.message.content || '',
        usage: {
          promptTokens: response.usage?.prompt_tokens || 0,
          completionTokens: response.usage?.completion_tokens || 0,
          totalTokens: response.usage?.total_tokens || 0,
        },
        finishReason: choice.finish_reason || undefined,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `OpenRouter completion error: ${errorMessage}`,
        errorStack,
      );
      throw error;
    }
  }

  private async *streamChat(
    request: AICompletionRequest,
  ): AsyncGenerator<string> {
    try {
      const stream = await this.getClient().chat.completions.create({
        model: request.model,
        messages: request.messages,
        temperature: request.temperature ?? 0.7,
        max_tokens: request.maxTokens,
        stream: true,
      });

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content;
        if (content) {
          yield content;
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`OpenRouter stream error: ${errorMessage}`, errorStack);
      throw error;
    }
  }
}

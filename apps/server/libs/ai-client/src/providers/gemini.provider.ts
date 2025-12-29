import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  IAIProviderAdapter,
  AICompletionRequest,
  AICompletionResponse,
  AIProvider,
  AIChatResponse,
} from '../interfaces/ai-provider.interface.js';
import { ConfigService as DbConfigService } from '@team9/database';

@Injectable()
export class GeminiProvider implements IAIProviderAdapter {
  private readonly logger = new Logger(GeminiProvider.name);
  private client: GoogleGenerativeAI | null = null;

  constructor(private readonly configService: DbConfigService) {}

  private getClient(): GoogleGenerativeAI {
    if (!this.client) {
      const config = this.configService.getAIProviderConfig('gemini');
      const apiKey = config.apiKey;
      if (!apiKey) {
        this.logger.warn(
          'GEMINI_API_KEY is not configured in database or environment',
        );
      }

      this.client = new GoogleGenerativeAI(apiKey || 'dummy-key');
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
      const model = this.getClient().getGenerativeModel({
        model: request.model,
      });

      const systemMessage = request.messages.find((m) => m.role === 'system');
      const conversationHistory = request.messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        }));

      const chat = model.startChat({
        history: conversationHistory.slice(0, -1),
        generationConfig: {
          temperature: request.temperature ?? 0.7,
          maxOutputTokens: request.maxTokens,
        },
        ...(systemMessage?.content && {
          systemInstruction: {
            role: 'user' as const,
            parts: [{ text: systemMessage.content }],
          },
        }),
      });

      const lastMessage =
        conversationHistory[conversationHistory.length - 1]?.parts[0]?.text ||
        '';

      const result = await chat.sendMessage(lastMessage);
      const response = result.response;

      return {
        provider: AIProvider.GEMINI,
        model: request.model,
        content: response.text(),
        usage: {
          promptTokens: response.usageMetadata?.promptTokenCount || 0,
          completionTokens: response.usageMetadata?.candidatesTokenCount || 0,
          totalTokens: response.usageMetadata?.totalTokenCount || 0,
        },
        finishReason: response.candidates?.[0]?.finishReason,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Gemini completion error: ${errorMessage}`, errorStack);
      throw error;
    }
  }

  private async *streamChat(
    request: AICompletionRequest,
  ): AsyncGenerator<string> {
    try {
      const model = this.getClient().getGenerativeModel({
        model: request.model,
      });

      const systemMessage = request.messages.find((m) => m.role === 'system');
      const conversationHistory = request.messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        }));

      const chat = model.startChat({
        history: conversationHistory.slice(0, -1),
        generationConfig: {
          temperature: request.temperature ?? 0.7,
          maxOutputTokens: request.maxTokens,
        },
        ...(systemMessage?.content && {
          systemInstruction: {
            role: 'user' as const,
            parts: [{ text: systemMessage.content }],
          },
        }),
      });

      const lastMessage =
        conversationHistory[conversationHistory.length - 1]?.parts[0]?.text ||
        '';

      const result = await chat.sendMessageStream(lastMessage);

      for await (const chunk of result.stream) {
        const text = chunk.text();
        if (text) {
          yield text;
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Gemini stream error: ${errorMessage}`, errorStack);
      throw error;
    }
  }
}

import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import {
  IAIProviderAdapter,
  AICompletionRequest,
  AIProvider,
  AIChatResponse,
} from './interfaces/ai-provider.interface';
import { OpenAIProvider } from './providers/openai.provider';
import { ClaudeProvider } from './providers/claude.provider';
import { GeminiProvider } from './providers/gemini.provider';
import { OpenRouterProvider } from './providers/openrouter.provider';

@Injectable()
export class AiClientService {
  private readonly logger = new Logger(AiClientService.name);
  private providers: Map<AIProvider, IAIProviderAdapter>;

  constructor(
    private readonly openAIProvider: OpenAIProvider,
    private readonly claudeProvider: ClaudeProvider,
    private readonly geminiProvider: GeminiProvider,
    private readonly openRouterProvider: OpenRouterProvider,
  ) {
    this.providers = new Map<AIProvider, IAIProviderAdapter>([
      [AIProvider.OPENAI, this.openAIProvider],
      [AIProvider.CLAUDE, this.claudeProvider],
      [AIProvider.GEMINI, this.geminiProvider],
      [AIProvider.OPENROUTER, this.openRouterProvider],
    ]);
  }

  chat<T extends boolean | undefined = undefined>(
    request: AICompletionRequest & { stream?: T },
  ): AIChatResponse<T> {
    const mode = request.stream ? 'stream' : 'completion';
    this.logger.log(
      `Processing ${mode} request for provider: ${request.provider}, model: ${request.model}`,
    );

    const provider = this.providers.get(request.provider);
    if (!provider) {
      throw new BadRequestException(
        `Unsupported AI provider: ${request.provider}`,
      );
    }

    return provider.chat(request);
  }
}

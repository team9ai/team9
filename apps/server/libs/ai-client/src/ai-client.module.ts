import { Module, Global } from '@nestjs/common';
import { DatabaseModule } from '@team9/database';
import { AiClientService } from './ai-client.service.js';
import { OpenAIProvider } from './providers/openai.provider.js';
import { ClaudeProvider } from './providers/claude.provider.js';
import { GeminiProvider } from './providers/gemini.provider.js';
import { OpenRouterProvider } from './providers/openrouter.provider.js';

@Global()
@Module({
  imports: [DatabaseModule],
  providers: [
    OpenAIProvider,
    ClaudeProvider,
    GeminiProvider,
    OpenRouterProvider,
    AiClientService,
  ],
  exports: [AiClientService],
})
export class AiClientModule {}

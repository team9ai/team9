import { Module, Global } from '@nestjs/common';
import { DatabaseModule } from '@team9/database';
import { AiClientService } from './ai-client.service';
import { OpenAIProvider } from './providers/openai.provider';
import { ClaudeProvider } from './providers/claude.provider';
import { GeminiProvider } from './providers/gemini.provider';
import { OpenRouterProvider } from './providers/openrouter.provider';

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

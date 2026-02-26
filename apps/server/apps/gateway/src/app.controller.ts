import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Sse,
  Logger,
  NotFoundException,
  MessageEvent,
  Version,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { Observable, from, catchError, of, switchMap } from 'rxjs';
import { v7 as uuidv7 } from 'uuid';
import { AppService } from './app.service.js';
import { RedisService } from '@team9/redis';
import { AiClientService } from '@team9/ai-client';
import type {
  AICompletionRequest,
  AICompletionResponse,
} from '@team9/ai-client';

@Controller()
export class AppController {
  private readonly logger = new Logger(AppController.name);

  constructor(
    private readonly appService: AppService,
    private readonly redisService: RedisService,
    private readonly aiClientService: AiClientService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Version(VERSION_NEUTRAL)
  @Get('health')
  healthCheck(): { status: string; timestamp: string } {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  @Post('ai/chat')
  async chat(@Body() body: AICompletionRequest): Promise<AICompletionResponse> {
    return this.aiClientService.chat({
      provider: body.provider,
      model: body.model,
      messages: body.messages,
      temperature: body.temperature,
      maxTokens: body.maxTokens,
      stream: false,
    });
  }

  @Get('ai/health')
  aiHealth(): { status: string; timestamp: string } {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  @Post('ai/chat-stream/session')
  async createStreamSession(
    @Body() body: AICompletionRequest,
  ): Promise<{ sessionId: string }> {
    const sessionId = uuidv7();
    const sessionKey = `chat-stream:${sessionId}`;

    await this.redisService.set(sessionKey, JSON.stringify(body), 60);

    this.logger.log(`Created stream session: ${sessionId}`);
    return { sessionId };
  }

  @Sse('ai/chat-stream/:sessionId')
  chatStream(@Param('sessionId') sessionId: string): Observable<MessageEvent> {
    const sessionKey = `chat-stream:${sessionId}`;

    return from(this.redisService.get(sessionKey)).pipe(
      switchMap((cached) => {
        if (!cached) {
          throw new NotFoundException(
            `Session ${sessionId} not found or expired`,
          );
        }

        void this.redisService.del(sessionKey);

        const body = JSON.parse(cached) as AICompletionRequest;
        this.logger.log(`Processing stream session: ${sessionId}`);

        return this.createStream(body);
      }),
      catchError((error) => {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(`Stream error: ${errorMessage}`);
        return of({ data: { error: errorMessage } } as MessageEvent);
      }),
    );
  }

  private createStream(body: AICompletionRequest): Observable<MessageEvent> {
    this.logger.log(
      `Processing stream request: provider=${body.provider}, model=${body.model}`,
    );

    const streamGenerator = this.aiClientService.chat({
      provider: body.provider,
      model: body.model,
      messages: body.messages,
      temperature: body.temperature,
      maxTokens: body.maxTokens,
      stream: true,
    });

    // Convert AsyncGenerator to Observable
    return new Observable<MessageEvent>((subscriber) => {
      void (async () => {
        try {
          for await (const chunk of streamGenerator) {
            subscriber.next({ data: { content: chunk } });
          }
          subscriber.next({ data: '[DONE]' });
          subscriber.complete();
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          this.logger.error(`Stream error: ${errorMessage}`);
          subscriber.next({ data: { error: errorMessage } });
          subscriber.complete();
        }
      })();
    });
  }
}

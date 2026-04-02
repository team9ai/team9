import {
  jest,
  beforeEach,
  afterEach,
  describe,
  it,
  expect,
} from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { of, lastValueFrom, toArray } from 'rxjs';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { RedisService } from '@team9/redis';
import { AiClientService } from '@team9/ai-client';

describe('AppController', () => {
  let appController: AppController;
  let redisService: {
    get: jest.Mock;
    set: jest.Mock;
    del: jest.Mock;
  };
  let aiClientService: {
    chat: jest.Mock;
  };

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-02T10:00:00.000Z'));

    redisService = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
    };

    aiClientService = {
      chat: jest.fn(),
    };

    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: RedisService,
          useValue: redisService,
        },
        {
          provide: AiClientService,
          useValue: aiClientService,
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });

  describe('health endpoints', () => {
    it('returns app health and ai health payloads with timestamps', () => {
      expect(appController.healthCheck()).toEqual({
        status: 'ok',
        timestamp: '2026-04-02T10:00:00.000Z',
      });
      expect(appController.aiHealth()).toEqual({
        status: 'ok',
        timestamp: '2026-04-02T10:00:00.000Z',
      });
    });
  });

  describe('chat', () => {
    it('delegates non-streaming chat requests to AiClientService', async () => {
      aiClientService.chat.mockResolvedValue({
        content: 'hello',
      });

      const result = await appController.chat({
        provider: 'openai',
        model: 'gpt-test',
        messages: [{ role: 'user', content: 'ping' }],
        temperature: 0.2,
        maxTokens: 128,
      } as never);

      expect(aiClientService.chat).toHaveBeenCalledWith({
        provider: 'openai',
        model: 'gpt-test',
        messages: [{ role: 'user', content: 'ping' }],
        temperature: 0.2,
        maxTokens: 128,
        stream: false,
      });
      expect(result).toEqual({ content: 'hello' });
    });
  });

  describe('stream sessions', () => {
    it('creates a cached stream session and returns its id', async () => {
      const body = {
        provider: 'openai',
        model: 'gpt-test',
        messages: [{ role: 'user', content: 'ping' }],
      };

      const result = await appController.createStreamSession(body as never);

      expect(result.sessionId).toBeTruthy();
      expect(redisService.set).toHaveBeenCalledWith(
        `chat-stream:${result.sessionId}`,
        JSON.stringify(body),
        60,
      );
    });

    it('returns an error event when the session is missing', async () => {
      redisService.get.mockResolvedValue(null);

      const result = await lastValueFrom(
        appController.chatStream('missing-session').pipe(toArray()),
      );

      expect(result).toEqual([
        { data: { error: 'Session missing-session not found or expired' } },
      ]);
      expect(redisService.del).not.toHaveBeenCalled();
    });

    it('loads the cached request, deletes the session, and proxies the stream', async () => {
      redisService.get.mockResolvedValue(
        JSON.stringify({
          provider: 'openai',
          model: 'gpt-test',
          messages: [{ role: 'user', content: 'ping' }],
        }),
      );
      jest
        .spyOn(appController as never, 'createStream')
        .mockReturnValue(
          of({ data: { content: 'chunk-1' } }, { data: '[DONE]' }) as never,
        );

      const result = await lastValueFrom(
        appController.chatStream('session-1').pipe(toArray()),
      );

      expect(redisService.del).toHaveBeenCalledWith('chat-stream:session-1');
      expect(result).toEqual([
        { data: { content: 'chunk-1' } },
        { data: '[DONE]' },
      ]);
    });
  });

  describe('createStream', () => {
    it('streams AI chunks and terminates with DONE', async () => {
      aiClientService.chat.mockReturnValue(
        (async function* () {
          yield 'chunk-1';
          yield 'chunk-2';
        })(),
      );

      const result = await lastValueFrom(
        (appController as never)
          .createStream({
            provider: 'openai',
            model: 'gpt-test',
            messages: [{ role: 'user', content: 'ping' }],
          })
          .pipe(toArray()),
      );

      expect(aiClientService.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'openai',
          model: 'gpt-test',
          stream: true,
        }),
      );
      expect(result).toEqual([
        { data: { content: 'chunk-1' } },
        { data: { content: 'chunk-2' } },
        { data: '[DONE]' },
      ]);
    });

    it('converts generator failures into stream error events', async () => {
      aiClientService.chat.mockReturnValue(
        (async function* () {
          yield 'chunk-1';
          throw new Error('stream failed');
        })(),
      );

      const result = await lastValueFrom(
        (appController as never)
          .createStream({
            provider: 'openai',
            model: 'gpt-test',
            messages: [{ role: 'user', content: 'ping' }],
          })
          .pipe(toArray()),
      );

      expect(result).toEqual([
        { data: { content: 'chunk-1' } },
        { data: { error: 'stream failed' } },
      ]);
    });
  });
});

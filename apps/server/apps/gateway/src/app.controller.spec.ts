import {
  jest,
  beforeEach,
  afterEach,
  describe,
  it,
  expect,
} from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-02T10:00:00.000Z'));

    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
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
});

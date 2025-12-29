import { AICompletionRequest, AICompletionResponse } from './ai.interface.js';

/**
 * Microservice message pattern enum
 */
export enum MessagePattern {
  AI_COMPLETION = 'ai.completion',
  AI_HEALTH = 'ai.health',
}

/**
 * Message pattern to request/response type mapping
 */
export interface MessageMap {
  [MessagePattern.AI_COMPLETION]: {
    request: AICompletionRequest;
    response: AICompletionResponse;
  };
  [MessagePattern.AI_HEALTH]: {
    request: Record<string, never>;
    response: {
      status: string;
      timestamp: string;
    };
  };
}

/**
 * Microservice message pattern type
 */
export type MessagePatternType<T extends MessagePattern> = {
  cmd: T;
};

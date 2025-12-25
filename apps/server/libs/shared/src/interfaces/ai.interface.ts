/**
 * AI Message interface
 */
export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * AI Completion Request interface
 */
export interface AICompletionRequest {
  provider: 'openai' | 'claude' | 'gemini' | 'openrouter';
  model: string;
  messages: AIMessage[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

/**
 * AI Completion Response interface
 */
export interface AICompletionResponse {
  provider: string;
  model: string;
  content: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason?: string;
}

/**
 * AI Provider enum
 */
export enum AIProvider {
  OPENAI = 'openai',
  CLAUDE = 'claude',
  GEMINI = 'gemini',
  OPENROUTER = 'openrouter',
}

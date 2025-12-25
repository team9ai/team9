export enum AIProvider {
  OPENAI = 'openai',
  CLAUDE = 'claude',
  GEMINI = 'gemini',
  OPENROUTER = 'openrouter',
}

// Claude (Anthropic) Models
export const CLAUDE_MODELS = [
  'claude-opus-4-20250514',
  'claude-sonnet-4-20250514',
  'claude-3-7-sonnet-20250219',
  'claude-3-5-sonnet-20241022',
  'claude-3-5-sonnet-20240620',
  'claude-3-5-haiku-20241022',
  'claude-3-opus-20240229',
  'claude-3-sonnet-20240229',
  'claude-3-haiku-20240307',
] as const;
export type ClaudeModel = (typeof CLAUDE_MODELS)[number];

// OpenAI Models
export const OPENAI_MODELS = [
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-4.1-nano',
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4-turbo',
  'gpt-4',
  'gpt-3.5-turbo',
  'o1',
  'o1-mini',
  'o1-preview',
  'o3',
  'o3-mini',
] as const;
export type OpenAIModel = (typeof OPENAI_MODELS)[number];

// Google Gemini Models
export const GEMINI_MODELS = [
  'gemini-3-pro-preview',
  'gemini-2.0-flash',
] as const;
export type GeminiModel = (typeof GEMINI_MODELS)[number];

// OpenRouter Models (common ones, supports many more)
export const OPENROUTER_MODELS = [
  'openai/gpt-4o',
  'openai/gpt-4-turbo',
  'anthropic/claude-3.5-sonnet',
  'anthropic/claude-3-opus',
  'google/gemini-pro-1.5',
  'meta-llama/llama-3.1-405b-instruct',
  'meta-llama/llama-3.1-70b-instruct',
  'mistralai/mistral-large',
  'deepseek/deepseek-chat',
] as const;
export type OpenRouterModel =
  | (typeof OPENROUTER_MODELS)[number]
  | (string & {});

// Model arrays by provider for runtime validation
export const MODELS_BY_PROVIDER: Record<AIProvider, readonly string[]> = {
  [AIProvider.CLAUDE]: CLAUDE_MODELS,
  [AIProvider.OPENAI]: OPENAI_MODELS,
  [AIProvider.GEMINI]: GEMINI_MODELS,
  [AIProvider.OPENROUTER]: OPENROUTER_MODELS,
};

// Union of all AI models
export type AIModel = ClaudeModel | OpenAIModel | GeminiModel | OpenRouterModel;

// Type mapping: Provider -> Model type
export type ModelForProvider<T extends AIProvider> = T extends AIProvider.CLAUDE
  ? ClaudeModel
  : T extends AIProvider.OPENAI
    ? OpenAIModel
    : T extends AIProvider.GEMINI
      ? GeminiModel
      : T extends AIProvider.OPENROUTER
        ? OpenRouterModel
        : string;

export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AICompletionRequest<T extends AIProvider = AIProvider> {
  provider: T;
  model: ModelForProvider<T>;
  messages: AIMessage[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface AICompletionResponse {
  provider: AIProvider;
  model: string;
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason?: string;
}

// 流式响应类型
export type AIStreamResponse = AsyncGenerator<string>;

// 统一的聊天返回类型
export type AIChatResponse<T extends boolean | undefined> = T extends true
  ? AIStreamResponse
  : Promise<AICompletionResponse>;

// 统一接口 - 根据 stream 参数决定返回类型
export interface IAIProviderAdapter {
  chat<T extends boolean | undefined = undefined>(
    request: AICompletionRequest & { stream?: T },
  ): AIChatResponse<T>;
}

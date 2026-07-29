/**
 * Configuration keys enum
 * Centralized definition of all allowed configuration keys
 */
export enum ConfigKey {
  // OpenAI Configuration
  OPENAI_API_KEY = 'OPENAI_API_KEY',
  OPENAI_BASE_URL = 'OPENAI_BASE_URL',

  // Claude (Anthropic) Configuration
  CLAUDE_API_KEY = 'CLAUDE_API_KEY',

  // Gemini (Google) Configuration
  GEMINI_API_KEY = 'GEMINI_API_KEY',

  // OpenRouter Configuration
  OPENROUTER_API_KEY = 'OPENROUTER_API_KEY',
  OPENROUTER_REFERER = 'OPENROUTER_REFERER',
  OPENROUTER_TITLE = 'OPENROUTER_TITLE',

  // MiniMax Configuration
  MINIMAX_API_KEY = 'MINIMAX_API_KEY',
  MINIMAX_API_BASE = 'MINIMAX_API_BASE',
}

/**
 * Configuration metadata for each key
 */
export const ConfigMetadata: Record<
  ConfigKey,
  {
    description: string;
    isSecret: boolean;
    defaultValue?: string;
  }
> = {
  [ConfigKey.OPENAI_API_KEY]: {
    description: 'OpenAI API key',
    isSecret: true,
  },
  [ConfigKey.OPENAI_BASE_URL]: {
    description: 'OpenAI API base URL (optional)',
    isSecret: false,
  },
  [ConfigKey.CLAUDE_API_KEY]: {
    description: 'Anthropic Claude API key',
    isSecret: true,
  },
  [ConfigKey.GEMINI_API_KEY]: {
    description: 'Google Gemini API key',
    isSecret: true,
  },
  [ConfigKey.OPENROUTER_API_KEY]: {
    description: 'OpenRouter API key',
    isSecret: true,
  },
  [ConfigKey.OPENROUTER_REFERER]: {
    description: 'OpenRouter HTTP referer header',
    isSecret: false,
  },
  [ConfigKey.OPENROUTER_TITLE]: {
    description: 'OpenRouter X-Title header',
    isSecret: false,
  },
  [ConfigKey.MINIMAX_API_KEY]: {
    description: 'MiniMax API key',
    isSecret: true,
  },
  [ConfigKey.MINIMAX_API_BASE]: {
    description: 'MiniMax OpenAI-compatible API base URL',
    isSecret: false,
    defaultValue: 'https://api.minimax.io/v1',
  },
};

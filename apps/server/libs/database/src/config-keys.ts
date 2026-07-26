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

  // Atlas Cloud Configuration
  ATLASCLOUD_API_KEY = 'ATLASCLOUD_API_KEY',
  ATLASCLOUD_API_BASE = 'ATLASCLOUD_API_BASE',
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
  [ConfigKey.ATLASCLOUD_API_KEY]: {
    description: 'Atlas Cloud API key',
    isSecret: true,
  },
  [ConfigKey.ATLASCLOUD_API_BASE]: {
    description: 'Atlas Cloud OpenAI-compatible API base URL',
    isSecret: false,
    defaultValue: 'https://api.atlascloud.ai/v1',
  },
};

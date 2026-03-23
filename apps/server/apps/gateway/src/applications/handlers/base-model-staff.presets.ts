export interface BaseModelPreset {
  key: string;
  name: string;
  provider: string;
  modelId: string;
  emoji: string;
  avatar: string;
}

export const BASE_MODEL_PRESETS: BaseModelPreset[] = [
  {
    key: 'claude',
    name: 'Claude',
    provider: 'openrouter',
    modelId: 'anthropic/claude-sonnet-4.6',
    emoji: '🟠',
    avatar: '/assets/avatars/claude.png',
  },
  {
    key: 'chatgpt',
    name: 'ChatGPT',
    provider: 'openrouter',
    modelId: 'openai/gpt-5.4-mini',
    emoji: '🟢',
    avatar: '/assets/avatars/chatgpt.png',
  },
  {
    key: 'gemini',
    name: 'Gemini',
    provider: 'openrouter',
    modelId: 'google/gemini-3-flash-preview',
    emoji: '🔵',
    avatar: '/assets/avatars/gemini.png',
  },
];

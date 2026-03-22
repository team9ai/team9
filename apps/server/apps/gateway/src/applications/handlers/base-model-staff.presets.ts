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
    provider: 'anthropic',
    modelId: 'claude-sonnet-4-6',
    emoji: '🟠',
    avatar: '/assets/avatars/claude.png',
  },
  {
    key: 'chatgpt',
    name: 'ChatGPT',
    provider: 'openai',
    modelId: 'gpt-5.4-mini',
    emoji: '🟢',
    avatar: '/assets/avatars/chatgpt.png',
  },
  {
    key: 'gemini',
    name: 'Gemini',
    provider: 'google',
    modelId: 'gemini-3-flash-preview',
    emoji: '🔵',
    avatar: '/assets/avatars/gemini.png',
  },
];

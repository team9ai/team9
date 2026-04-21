export interface StaffModel {
  provider: string;
  id: string;
  label: string;
  default?: boolean;
}

export const COMMON_STAFF_MODELS: StaffModel[] = [
  {
    provider: "openrouter",
    id: "anthropic/claude-opus-4.7",
    label: "Claude Opus 4.7",
  },
  {
    provider: "openrouter",
    id: "anthropic/claude-sonnet-4.6",
    label: "Claude Sonnet 4.6",
    default: true,
  },
  { provider: "openrouter", id: "openai/gpt-5.4", label: "GPT-5.4" },
  {
    provider: "openrouter",
    id: "openai/gpt-5.4-mini",
    label: "GPT-5.4 Mini",
  },
  {
    provider: "openrouter",
    id: "google/gemini-3.1-pro-preview",
    label: "Gemini 3.1 Pro (Preview)",
  },
  {
    provider: "openrouter",
    id: "google/gemini-3-flash-preview",
    label: "Gemini 3 Flash (Preview)",
  },
  {
    provider: "openrouter",
    id: "qwen/qwen3.6-plus",
    label: "Qwen 3.6 Plus",
  },
  { provider: "openrouter", id: "z-ai/glm-5.1", label: "GLM 5.1" },
  {
    provider: "openrouter",
    id: "moonshotai/kimi-k2.6",
    label: "Kimi K2.6",
  },
];

export const DEFAULT_STAFF_MODEL = COMMON_STAFF_MODELS.find((m) => m.default)!;

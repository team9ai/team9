export interface StaffModel {
  provider: string;
  id: string;
  label: string;
  default?: boolean;
}

export const COMMON_STAFF_MODELS: StaffModel[] = [
  {
    provider: "openrouter",
    id: "anthropic/claude-sonnet-4.6",
    label: "Claude Sonnet 4.6",
    default: true,
  },
  {
    provider: "openrouter",
    id: "anthropic/claude-opus-4.6",
    label: "Claude Opus 4.6",
  },
  { provider: "openrouter", id: "openai/gpt-4.1", label: "GPT-4.1" },
  { provider: "openrouter", id: "openai/o3", label: "o3" },
  {
    provider: "openrouter",
    id: "google/gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
  },
];

export const DEFAULT_STAFF_MODEL = COMMON_STAFF_MODELS.find((m) => m.default)!;

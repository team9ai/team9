export interface StaffModel {
  provider: string;
  id: string;
  label: string;
  default?: boolean;
}

export const COMMON_STAFF_MODELS: StaffModel[] = [
  {
    provider: "anthropic",
    id: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    default: true,
  },
  { provider: "anthropic", id: "claude-opus-4-6", label: "Claude Opus 4.6" },
  { provider: "openai", id: "gpt-4.1", label: "GPT-4.1" },
  { provider: "openai", id: "o3", label: "o3" },
  { provider: "google", id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
];

export const DEFAULT_STAFF_MODEL = COMMON_STAFF_MODELS.find((m) => m.default)!;

import { useState } from "react";
import type { LLMConfig } from "@/types";

interface LLMConfigEditorProps {
  config: LLMConfig;
  onChange: (config: LLMConfig) => void;
}

interface ModelGroup {
  label: string;
  models: { value: string; label: string }[];
}

const MODEL_GROUPS: ModelGroup[] = [
  {
    label: "Anthropic (Claude)",
    models: [
      { value: "anthropic/claude-opus-4.5", label: "Claude Opus 4.5" },
      { value: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4" },
      { value: "anthropic/claude-haiku-4.5", label: "Claude Haiku 4.5" },
      { value: "anthropic/claude-3.7-sonnet", label: "Claude 3.7 Sonnet" },
      { value: "anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet" },
      { value: "anthropic/claude-3.5-haiku", label: "Claude 3.5 Haiku" },
      { value: "anthropic/claude-3-opus", label: "Claude 3 Opus" },
      { value: "anthropic/claude-3-sonnet", label: "Claude 3 Sonnet" },
      { value: "anthropic/claude-3-haiku", label: "Claude 3 Haiku" },
    ],
  },
  {
    label: "Google (Gemini)",
    models: [
      { value: "google/gemini-3-pro-preview", label: "Gemini 3 Pro (Preview)" },
      {
        value: "google/gemini-3-flash-preview",
        label: "Gemini 3 Flash (Preview)",
      },
      {
        value: "google/gemini-3-pro-image-preview",
        label: "Gemini 3 Pro Image (Preview)",
      },
      { value: "google/gemini-2.5-pro-preview", label: "Gemini 2.5 Pro" },
      { value: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash" },
      {
        value: "google/gemini-2.5-flash-image",
        label: "Gemini 2.5 Flash Image",
      },
      { value: "google/gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite" },
      { value: "google/gemini-2.0-flash-001", label: "Gemini 2.0 Flash" },
      {
        value: "google/gemini-2.0-flash-exp:free",
        label: "Gemini 2.0 Flash (Free)",
      },
    ],
  },
  {
    label: "OpenAI (GPT)",
    models: [
      { value: "openai/gpt-5.2-pro", label: "GPT-5.2 Pro" },
      { value: "openai/gpt-5.2-chat", label: "GPT-5.2 Chat" },
      { value: "openai/gpt-5.2", label: "GPT-5.2" },
      { value: "openai/gpt-5.1", label: "GPT-5.1" },
      { value: "openai/gpt-5.1-chat", label: "GPT-5.1 Chat" },
      { value: "openai/gpt-5.1-codex", label: "GPT-5.1 Codex" },
      { value: "openai/gpt-5.1-codex-mini", label: "GPT-5.1 Codex Mini" },
      { value: "openai/gpt-5.1-codex-max", label: "GPT-5.1 Codex Max" },
      { value: "openai/gpt-5-image", label: "GPT-5 Image" },
      { value: "openai/gpt-5-image-mini", label: "GPT-5 Image Mini" },
      { value: "openai/o3-deep-research", label: "o3 Deep Research" },
      { value: "openai/o4-mini-deep-research", label: "o4-mini Deep Research" },
      { value: "openai/gpt-4o", label: "GPT-4o" },
      { value: "openai/gpt-4o-mini", label: "GPT-4o Mini" },
      { value: "openai/gpt-4-turbo", label: "GPT-4 Turbo" },
    ],
  },
  {
    label: "DeepSeek",
    models: [
      { value: "deepseek/deepseek-v3.2", label: "DeepSeek V3.2" },
      {
        value: "deepseek/deepseek-v3.2-speciale",
        label: "DeepSeek V3.2 Speciale",
      },
      { value: "deepseek/deepseek-chat", label: "DeepSeek Chat" },
      { value: "deepseek/deepseek-r1", label: "DeepSeek R1" },
      {
        value: "deepseek/deepseek-r1-distill-llama-70b",
        label: "DeepSeek R1 Distill 70B",
      },
    ],
  },
  {
    label: "xAI (Grok)",
    models: [
      { value: "x-ai/grok-4.1-fast", label: "Grok 4.1 Fast" },
      { value: "x-ai/grok-3", label: "Grok 3" },
      { value: "x-ai/grok-2", label: "Grok 2" },
    ],
  },
  {
    label: "Qwen",
    models: [
      { value: "qwen/qwen3-vl-32b-instruct", label: "Qwen3 VL 32B" },
      { value: "qwen/qwen3-vl-8b-instruct", label: "Qwen3 VL 8B" },
      { value: "qwen/qwen3-vl-8b-thinking", label: "Qwen3 VL 8B Thinking" },
      {
        value: "qwen/qwen3-vl-30b-a3b-thinking",
        label: "Qwen3 VL 30B Thinking",
      },
      { value: "qwen/qwen-2.5-72b-instruct", label: "Qwen 2.5 72B" },
      {
        value: "qwen/qwen-2.5-coder-32b-instruct",
        label: "Qwen 2.5 Coder 32B",
      },
    ],
  },
  {
    label: "Mistral",
    models: [
      { value: "mistralai/mistral-large-2512", label: "Mistral Large (2512)" },
      {
        value: "mistralai/mistral-small-creative",
        label: "Mistral Small Creative",
      },
      { value: "mistralai/devstral-2512", label: "Devstral (2512)" },
      { value: "mistralai/ministral-14b-2512", label: "Ministral 14B" },
      { value: "mistralai/ministral-8b-2512", label: "Ministral 8B" },
      { value: "mistralai/ministral-3b-2512", label: "Ministral 3B" },
      { value: "mistralai/voxtral-small-24b-2507", label: "Voxtral Small 24B" },
    ],
  },
  {
    label: "Meta (Llama)",
    models: [
      { value: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B" },
      {
        value: "meta-llama/llama-3.2-90b-vision-instruct",
        label: "Llama 3.2 90B Vision",
      },
      {
        value: "meta-llama/llama-3.2-11b-vision-instruct",
        label: "Llama 3.2 11B Vision",
      },
      { value: "meta-llama/llama-3.1-405b-instruct", label: "Llama 3.1 405B" },
      { value: "meta-llama/llama-3.1-70b-instruct", label: "Llama 3.1 70B" },
      { value: "meta-llama/llama-3.1-8b-instruct", label: "Llama 3.1 8B" },
    ],
  },
  {
    label: "Other",
    models: [
      {
        value: "nvidia/llama-3.3-nemotron-super-49b-v1.5",
        label: "NVIDIA Nemotron Super 49B",
      },
      {
        value: "nvidia/nemotron-3-nano-30b-a3b",
        label: "NVIDIA Nemotron Nano 30B",
      },
      { value: "amazon/nova-premier-v1", label: "Amazon Nova Premier" },
      { value: "amazon/nova-2-lite-v1", label: "Amazon Nova 2 Lite" },
      {
        value: "moonshotai/kimi-k2-thinking",
        label: "Moonshot Kimi K2 Thinking",
      },
      {
        value: "baidu/ernie-4.5-21b-a3b-thinking",
        label: "Baidu ERNIE 4.5 Thinking",
      },
      { value: "minimax/minimax-m2.1", label: "MiniMax M2.1" },
      { value: "minimax/minimax-m2", label: "MiniMax M2" },
      {
        value: "bytedance-seed/seed-1.6-flash",
        label: "ByteDance Seed 1.6 Flash",
      },
      { value: "bytedance-seed/seed-1.6", label: "ByteDance Seed 1.6" },
      { value: "perplexity/sonar-pro-search", label: "Perplexity Sonar Pro" },
    ],
  },
];

export function LLMConfigEditor({ config, onChange }: LLMConfigEditorProps) {
  const [customModel, setCustomModel] = useState("");
  const [showCustom, setShowCustom] = useState(false);

  const updateConfig = (updates: Partial<LLMConfig>) => {
    onChange({ ...config, ...updates });
  };

  const handleCustomModelSubmit = () => {
    if (customModel.trim()) {
      updateConfig({ model: customModel.trim() });
      setShowCustom(false);
    }
  };

  // Check if current model is in the predefined list
  const isCustomModel =
    config.model &&
    !MODEL_GROUPS.some((group) =>
      group.models.some((m) => m.value === config.model),
    );

  return (
    <div className="rounded-md border p-4 space-y-4">
      {/* Model */}
      <div>
        <div className="flex items-center justify-between">
          <label className="block text-xs font-medium text-muted-foreground">
            Model <span className="text-destructive">*</span>
          </label>
          <button
            type="button"
            onClick={() => setShowCustom(!showCustom)}
            className="text-xs text-primary hover:underline"
          >
            {showCustom ? "Select from list" : "Enter custom model"}
          </button>
        </div>

        {showCustom ? (
          <div className="mt-1 flex gap-2">
            <input
              type="text"
              value={customModel}
              onChange={(e) => setCustomModel(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCustomModelSubmit()}
              placeholder="e.g., anthropic/claude-opus-4.5"
              className="flex-1 rounded-md border bg-background p-2 text-sm font-mono"
            />
            <button
              type="button"
              onClick={handleCustomModelSubmit}
              className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground hover:bg-primary/90"
            >
              Set
            </button>
          </div>
        ) : (
          <select
            value={config.model}
            onChange={(e) => updateConfig({ model: e.target.value })}
            className="mt-1 w-full rounded-md border bg-background p-2 text-sm"
          >
            <option value="">Select a model</option>
            {MODEL_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.models.map((model) => (
                  <option key={model.value} value={model.value}>
                    {model.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        )}

        {isCustomModel && !showCustom && (
          <p className="mt-1 text-xs text-muted-foreground">
            Custom model:{" "}
            <code className="bg-muted px-1 rounded">{config.model}</code>
          </p>
        )}
      </div>

      {/* Temperature and Max Tokens */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-muted-foreground">
            Temperature
          </label>
          <input
            type="number"
            value={config.temperature ?? 0.7}
            onChange={(e) =>
              updateConfig({ temperature: parseFloat(e.target.value) })
            }
            className="mt-1 w-full rounded-md border bg-background p-2 text-sm"
            min={0}
            max={2}
            step={0.1}
          />
          <p className="mt-1 text-[10px] text-muted-foreground">
            0 = deterministic, 2 = very random
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground">
            Max Tokens
          </label>
          <input
            type="number"
            value={config.maxTokens ?? 4096}
            onChange={(e) =>
              updateConfig({ maxTokens: parseInt(e.target.value) })
            }
            className="mt-1 w-full rounded-md border bg-background p-2 text-sm"
            min={1}
            max={200000}
          />
        </div>
      </div>

      {/* Top P */}
      <div>
        <label className="block text-xs font-medium text-muted-foreground">
          Top P
        </label>
        <input
          type="number"
          value={config.topP ?? 1}
          onChange={(e) => updateConfig({ topP: parseFloat(e.target.value) })}
          className="mt-1 w-full rounded-md border bg-background p-2 text-sm"
          min={0}
          max={1}
          step={0.1}
        />
        <p className="mt-1 text-[10px] text-muted-foreground">
          Nucleus sampling threshold (0-1)
        </p>
      </div>

      {/* Frequency and Presence Penalty */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-muted-foreground">
            Frequency Penalty
          </label>
          <input
            type="number"
            value={config.frequencyPenalty ?? 0}
            onChange={(e) =>
              updateConfig({ frequencyPenalty: parseFloat(e.target.value) })
            }
            className="mt-1 w-full rounded-md border bg-background p-2 text-sm"
            min={-2}
            max={2}
            step={0.1}
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground">
            Presence Penalty
          </label>
          <input
            type="number"
            value={config.presencePenalty ?? 0}
            onChange={(e) =>
              updateConfig({ presencePenalty: parseFloat(e.target.value) })
            }
            className="mt-1 w-full rounded-md border bg-background p-2 text-sm"
            min={-2}
            max={2}
            step={0.1}
          />
        </div>
      </div>
    </div>
  );
}

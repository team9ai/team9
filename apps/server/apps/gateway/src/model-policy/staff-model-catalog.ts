export type DynamicModelCapability = 'staff';
export type StaffModelFamily = 'anthropic' | 'openai' | 'google' | 'other';

export interface StaffModelCatalogEntry {
  readonly provider: 'openrouter';
  readonly id: string;
  readonly displayKey: string;
  readonly label: string;
  readonly family: StaffModelFamily;
  readonly enabled: boolean;
  readonly capabilities: readonly DynamicModelCapability[];
  readonly minimumResolverCapabilityVersion: string;
  readonly default?: boolean;
}

export const STAFF_MODEL_CATALOG_VERSION = '2026-07-16.1';
export const STAFF_MODEL_RESOLVER_CAPABILITY_VERSION = '1.0.0';

const urlLikeModelValue = /^[a-z][a-z0-9+.-]*:\/\//i;

export function isUnsafeModelValue(value: string): boolean {
  return (
    urlLikeModelValue.test(value) ||
    Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127;
    })
  );
}

function entry(
  id: string,
  label: string,
  family: StaffModelFamily,
  options: { default?: boolean } = {},
): StaffModelCatalogEntry {
  return {
    provider: 'openrouter',
    id,
    displayKey: `staff-model.${id}`,
    label,
    family,
    enabled: true,
    capabilities: ['staff'],
    minimumResolverCapabilityVersion: STAFF_MODEL_RESOLVER_CAPABILITY_VERSION,
    ...options,
  };
}

export const STAFF_MODEL_CATALOG = [
  entry('anthropic/claude-opus-4.7', 'Claude Opus 4.7', 'anthropic'),
  entry('anthropic/claude-sonnet-4.6', 'Claude Sonnet 4.6', 'anthropic', {
    default: true,
  }),
  entry('openai/gpt-5.5', 'GPT-5.5', 'openai'),
  entry('openai/gpt-5.4', 'GPT-5.4', 'openai'),
  entry('openai/gpt-5.4-mini', 'GPT-5.4 Mini', 'openai'),
  entry('google/gemini-3.5-flash', 'Gemini 3.5 Flash', 'google'),
  entry('google/gemini-3.1-pro-preview', 'Gemini 3.1 Pro (Preview)', 'google'),
  entry('google/gemini-3-flash-preview', 'Gemini 3 Flash (Preview)', 'google'),
  entry('deepseek/deepseek-v4-pro', 'DeepSeek V4 Pro', 'other'),
  entry('qwen/qwen3.6-plus', 'Qwen 3.6 Plus', 'other'),
  entry('z-ai/glm-5.1', 'GLM 5.1', 'other'),
  entry('moonshotai/kimi-k2.6', 'Kimi K2.6', 'other'),
] as const satisfies readonly StaffModelCatalogEntry[];

export function getDefaultStaffModel(
  capability: DynamicModelCapability,
): StaffModelCatalogEntry {
  const model = STAFF_MODEL_CATALOG.find(
    (entry) =>
      entry.enabled &&
      entry.default === true &&
      entry.capabilities.includes(capability),
  );
  if (!model) {
    throw new Error(
      `Staff model catalog has no enabled default for ${capability}`,
    );
  }
  return model;
}

export function validateStaffModelCatalog(
  catalog: readonly StaffModelCatalogEntry[],
): void {
  const pairs = new Set<string>();
  const defaults = new Map<DynamicModelCapability, number>();

  for (const model of catalog) {
    if (
      model.provider.length === 0 ||
      model.provider.length > 128 ||
      model.id.length === 0 ||
      model.id.length > 256 ||
      isUnsafeModelValue(model.provider) ||
      isUnsafeModelValue(model.id)
    ) {
      throw new Error(`Unsafe staff model catalog entry: ${model.displayKey}`);
    }

    const pair = `${model.provider}\u0000${model.id}`;
    if (pairs.has(pair)) {
      throw new Error(`Duplicate staff model catalog pair: ${model.provider}`);
    }
    pairs.add(pair);

    if (!model.enabled) continue;
    for (const capability of model.capabilities) {
      if (model.default) {
        defaults.set(capability, (defaults.get(capability) ?? 0) + 1);
      }
    }
  }

  for (const capability of ['staff'] as const) {
    if (defaults.get(capability) !== 1) {
      throw new Error(
        `Staff model catalog must define exactly one default for ${capability}`,
      );
    }
  }
}

validateStaffModelCatalog(STAFF_MODEL_CATALOG);

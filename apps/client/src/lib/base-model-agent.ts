export type BaseModelProductKey = "claude" | "chatgpt" | "gemini";

export const BASE_MODEL_PRODUCT_META: Record<
  BaseModelProductKey,
  { provider: string; alt: string }
> = {
  claude: { provider: "Anthropic", alt: "Claude logo" },
  chatgpt: { provider: "OpenAI", alt: "ChatGPT logo" },
  gemini: { provider: "Google", alt: "Gemini logo" },
};

export function getBaseModelProductKey(
  agentId: string | null | undefined,
): BaseModelProductKey | null {
  if (!agentId) return null;

  const productKeys: BaseModelProductKey[] = ["claude", "chatgpt", "gemini"];

  for (const key of productKeys) {
    if (agentId.includes(`-${key}-`)) {
      return key;
    }
  }

  return null;
}

export function getBaseModelProductMeta(agentId: string | null | undefined) {
  const productKey = getBaseModelProductKey(agentId);
  return productKey
    ? { key: productKey, ...BASE_MODEL_PRODUCT_META[productKey] }
    : null;
}

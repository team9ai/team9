import type { StaffModelFamily } from "./common-staff-models";

export type BaseModelProductKey = "claude" | "chatgpt" | "gemini";

export const BASE_MODEL_PRODUCT_META: Record<
  BaseModelProductKey,
  { provider: string; alt: string }
> = {
  claude: { provider: "Anthropic", alt: "Claude logo" },
  chatgpt: { provider: "OpenAI", alt: "ChatGPT logo" },
  gemini: { provider: "Google", alt: "Gemini logo" },
};

export const BASE_MODEL_PRODUCT_FAMILY: Record<
  BaseModelProductKey,
  StaffModelFamily
> = {
  claude: "anthropic",
  chatgpt: "openai",
  gemini: "google",
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

export function getBaseModelProductKeyFromBotIdentity({
  isBot,
  name,
  username,
}: {
  isBot?: boolean;
  name?: string | null;
  username?: string | null;
}): BaseModelProductKey | null {
  if (!isBot) return null;

  const normalizedName = name?.trim().toLowerCase() ?? "";
  const normalizedUsername = username?.trim().toLowerCase() ?? "";

  if (
    normalizedName === "claude" ||
    normalizedUsername.startsWith("claude_bot")
  ) {
    return "claude";
  }

  if (
    normalizedName === "chatgpt" ||
    normalizedUsername.startsWith("chatgpt_bot")
  ) {
    return "chatgpt";
  }

  if (
    normalizedName === "gemini" ||
    normalizedUsername.startsWith("gemini_bot")
  ) {
    return "gemini";
  }

  return null;
}

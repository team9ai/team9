import { Bot } from "lucide-react";

import chatgptLogo from "@/assets/base-model/chatgpt.webp";
import claudeLogo from "@/assets/base-model/claude.webp";
import geminiLogo from "@/assets/base-model/gemini.webp";
import {
  BASE_MODEL_PRODUCT_META,
  getBaseModelProductKey,
  type BaseModelProductKey,
} from "@/lib/base-model-agent";

const PRODUCT_LOGOS: Record<BaseModelProductKey, string> = {
  claude: claudeLogo,
  chatgpt: chatgptLogo,
  gemini: geminiLogo,
};

interface BaseModelProductLogoProps {
  agentId?: string | null;
}

export function BaseModelProductLogo({ agentId }: BaseModelProductLogoProps) {
  const productKey = getBaseModelProductKey(agentId);

  return (
    <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-background shrink-0 overflow-hidden">
      {productKey ? (
        <img
          src={PRODUCT_LOGOS[productKey]}
          alt={BASE_MODEL_PRODUCT_META[productKey].alt}
          className="h-full w-full object-cover"
        />
      ) : (
        <Bot size={20} aria-hidden="true" />
      )}
    </div>
  );
}

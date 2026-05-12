import type { ComponentProps } from "react";

import chatgptLogo from "@/assets/base-model/chatgpt.svg";
import claudeLogo from "@/assets/base-model/claude.png";
import geminiLogo from "@/assets/base-model/gemini.svg";
import kimiLogo from "@/assets/base-model/kimi.svg";
import qwenLogo from "@/assets/base-model/qwen.svg";
import zAiLogo from "@/assets/base-model/z-ai.svg";
import type { StaffModelFamily } from "@/lib/common-staff-models";
import { cn } from "@/lib/utils";

interface StaffModelLogoIdentity {
  provider?: string | null;
  id?: string | null;
  label?: string | null;
  family?: StaffModelFamily | null;
}

type LogoMeta = {
  type: "image";
  alt: string;
  src: string;
};

function getStaffModelLogoMeta(
  model: StaffModelLogoIdentity | null | undefined,
): LogoMeta | null {
  if (!model) return null;

  const identity = [model.provider, model.id, model.label, model.family]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (identity.includes("anthropic") || identity.includes("claude")) {
    return { type: "image", alt: "Claude logo", src: claudeLogo };
  }

  if (identity.includes("openai") || identity.includes("gpt")) {
    return { type: "image", alt: "ChatGPT logo", src: chatgptLogo };
  }

  if (identity.includes("google") || identity.includes("gemini")) {
    return { type: "image", alt: "Gemini logo", src: geminiLogo };
  }

  if (identity.includes("qwen") || identity.includes("alibaba")) {
    return { type: "image", alt: "Qwen logo", src: qwenLogo };
  }

  if (
    identity.includes("z-ai") ||
    identity.includes("zai") ||
    identity.includes("glm") ||
    identity.includes("zhipu")
  ) {
    return { type: "image", alt: "GLM logo", src: zAiLogo };
  }

  if (identity.includes("moonshot") || identity.includes("kimi")) {
    return { type: "image", alt: "Kimi logo", src: kimiLogo };
  }

  return null;
}

interface StaffModelProviderLogoProps extends Omit<
  ComponentProps<"img">,
  "children" | "src" | "alt"
> {
  model: StaffModelLogoIdentity | null | undefined;
}

export function StaffModelProviderLogo({
  model,
  className,
  ...props
}: StaffModelProviderLogoProps) {
  const meta = getStaffModelLogoMeta(model);

  if (!meta) return null;

  const baseClassName =
    "inline-flex size-4 shrink-0 items-center justify-center overflow-hidden rounded-[0.3rem] ring-1";

  return (
    <img
      src={meta.src}
      alt={meta.alt}
      className={cn(
        baseClassName,
        "bg-white object-contain p-[2px] ring-black/5",
        className,
      )}
      {...props}
    />
  );
}

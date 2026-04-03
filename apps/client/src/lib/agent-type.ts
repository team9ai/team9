import type { AgentType } from "@/types/im";

export function getAgentTypeLabel(
  agentType: AgentType | null | undefined,
): string | null {
  if (agentType === "base_model") {
    return "Model";
  }

  if (agentType === "openclaw") {
    return "Openclaw";
  }

  return null;
}

import { getAgentMeta } from "@/lib/agent-events";
import type { Message } from "@/types/im";

export type BotThinkingPhase = "warming" | "working";

export interface BotThinkingStatus {
  botId: string;
  phase: BotThinkingPhase;
}

export function startBotThinkingStatuses(
  botIds: string[],
): BotThinkingStatus[] {
  return Array.from(new Set(botIds)).map((botId) => ({
    botId,
    phase: "warming" as const,
  }));
}

export function getBotThinkingIds(statuses: readonly BotThinkingStatus[]) {
  return statuses.map((status) => status.botId);
}

export function upsertBotThinkingStatus(
  statuses: readonly BotThinkingStatus[],
  botId: string,
  phase: BotThinkingPhase,
): BotThinkingStatus[] {
  let found = false;
  const next = statuses.map((status) => {
    if (status.botId !== botId) return status;
    found = true;
    return { ...status, phase };
  });
  return found ? next : [...next, { botId, phase }];
}

export function removeBotThinkingStatus(
  statuses: readonly BotThinkingStatus[],
  botId: string,
): BotThinkingStatus[] {
  return statuses.filter((status) => status.botId !== botId);
}

export function applyBotThinkingMessage(
  statuses: BotThinkingStatus[],
  message: Message,
): BotThinkingStatus[] {
  if (!message.senderId) return statuses;

  const meta = getAgentMeta(message);
  if (meta?.agentEventType === "agent_start") {
    return upsertBotThinkingStatus(statuses, message.senderId, "working");
  }
  if (meta?.agentEventType === "agent_end") {
    return removeBotThinkingStatus(statuses, message.senderId);
  }

  return statuses;
}

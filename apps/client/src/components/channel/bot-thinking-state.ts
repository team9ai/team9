import { getAgentMeta } from "@/lib/agent-events";
import type { Message } from "@/types/im";

export type BotThinkingPhase = "warming" | "working";

export interface BotThinkingStatus {
  botId: string;
  phase: BotThinkingPhase;
  startedAfterMs?: number;
}

const DEBUG_STORAGE_KEY = "team9.debugBotThinking";

function debugBotThinking(
  event: string,
  payload: Record<string, unknown>,
): void {
  if (typeof window === "undefined") return;
  try {
    if (window.localStorage.getItem(DEBUG_STORAGE_KEY) !== "1") return;
  } catch {
    return;
  }
  console.debug(`[bot-thinking] ${event}`, payload);
}

export function startBotThinkingStatuses(
  botIds: string[],
  startedAfterMs?: number,
): BotThinkingStatus[] {
  return Array.from(new Set(botIds)).map((botId) => ({
    botId,
    phase: "warming" as const,
    ...(typeof startedAfterMs === "number" ? { startedAfterMs } : {}),
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

function getMessageTimeMs(message: Message): number {
  const time = new Date(message.createdAt).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function sortMessagesChronologically(messages: readonly Message[]): Message[] {
  return messages
    .map((message, index) => ({
      message,
      index,
      time: getMessageTimeMs(message),
    }))
    .sort((a, b) => a.time - b.time || a.index - b.index)
    .map((item) => item.message);
}

function shouldIgnoreMessageForStatus(
  status: BotThinkingStatus | undefined,
  message: Message,
): boolean {
  return (
    typeof status?.startedAfterMs === "number" &&
    getMessageTimeMs(message) <= status.startedAfterMs
  );
}

function areBotThinkingStatusesEqual(
  a: readonly BotThinkingStatus[],
  b: readonly BotThinkingStatus[],
): boolean {
  return (
    a.length === b.length &&
    a.every(
      (status, index) =>
        status.botId === b[index]?.botId &&
        status.phase === b[index]?.phase &&
        status.startedAfterMs === b[index]?.startedAfterMs,
    )
  );
}

export function applyBotThinkingMessage(
  statuses: BotThinkingStatus[],
  message: Message,
): BotThinkingStatus[] {
  if (!message.senderId) return statuses;

  const status = statuses.find((item) => item.botId === message.senderId);
  if (shouldIgnoreMessageForStatus(status, message)) {
    debugBotThinking("ignore-old-message", {
      messageId: message.id,
      senderId: message.senderId,
      createdAt: message.createdAt,
      status,
      metadata: message.metadata,
    });
    return statuses;
  }

  const meta = getAgentMeta(message);
  if (meta?.agentEventType === "agent_start") {
    debugBotThinking("agent-start", {
      messageId: message.id,
      senderId: message.senderId,
      createdAt: message.createdAt,
      status,
    });
    return upsertBotThinkingStatus(statuses, message.senderId, "working");
  }
  if (meta?.agentEventType === "agent_end") {
    debugBotThinking("agent-end", {
      messageId: message.id,
      senderId: message.senderId,
      createdAt: message.createdAt,
      status,
    });
    return removeBotThinkingStatus(statuses, message.senderId);
  }
  if (
    meta?.agentEventType === "writing" &&
    meta.status === "completed" &&
    status?.phase === "warming"
  ) {
    debugBotThinking("clear-stale-warmup-on-writing", {
      messageId: message.id,
      senderId: message.senderId,
      createdAt: message.createdAt,
      status,
    });
    return removeBotThinkingStatus(statuses, message.senderId);
  }
  if (!meta) {
    if (status) {
      debugBotThinking("clear-on-plain-message", {
        messageId: message.id,
        senderId: message.senderId,
        createdAt: message.createdAt,
        status,
      });
      return removeBotThinkingStatus(statuses, message.senderId);
    }
  }

  return statuses;
}

export function syncBotThinkingStatusesWithMessages(
  statuses: BotThinkingStatus[],
  messages: readonly Message[],
): BotThinkingStatus[] {
  const next = sortMessagesChronologically(messages).reduce<
    BotThinkingStatus[]
  >((current, message) => applyBotThinkingMessage(current, message), statuses);
  return areBotThinkingStatusesEqual(statuses, next) ? statuses : next;
}

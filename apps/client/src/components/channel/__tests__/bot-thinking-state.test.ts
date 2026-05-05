import { describe, expect, it } from "vitest";
import type { Message } from "@/types/im";
import {
  applyBotThinkingMessage,
  type BotThinkingStatus,
  startBotThinkingStatuses,
} from "../bot-thinking-state";

function makeTrackingMessage(
  agentEventType: "agent_start" | "agent_end",
  senderId = "bot-1",
): Message {
  return {
    id: `${agentEventType}-1`,
    channelId: "ch-1",
    senderId,
    content: "",
    type: "tracking",
    metadata: { agentEventType, status: "completed" },
    isPinned: false,
    isEdited: false,
    isDeleted: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

describe("bot thinking state", () => {
  it("starts bots in warmup phase", () => {
    expect(startBotThinkingStatuses(["bot-1"])).toEqual([
      { botId: "bot-1", phase: "warming" },
    ]);
  });

  it("switches a bot to working phase when agent_start arrives", () => {
    const state = startBotThinkingStatuses(["bot-1"]);

    expect(
      applyBotThinkingMessage(state, makeTrackingMessage("agent_start")),
    ).toEqual([{ botId: "bot-1", phase: "working" }]);
  });

  it("removes a bot when agent_end arrives", () => {
    const state: BotThinkingStatus[] = [{ botId: "bot-1", phase: "working" }];

    expect(
      applyBotThinkingMessage(state, makeTrackingMessage("agent_end")),
    ).toEqual([]);
  });
});

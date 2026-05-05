import { describe, expect, it } from "vitest";
import type { Message } from "@/types/im";
import {
  applyBotThinkingMessage,
  syncBotThinkingStatusesWithMessages,
  type BotThinkingStatus,
  startBotThinkingStatuses,
} from "../bot-thinking-state";

function makeTrackingMessage(
  agentEventType: "agent_start" | "agent_end",
  senderId = "bot-1",
  createdAt = "2026-01-01T00:00:00Z",
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
    createdAt,
    updatedAt: createdAt,
  };
}

function makeTextMessage(
  senderId = "bot-1",
  createdAt = "2026-01-01T00:00:00Z",
): Message {
  return {
    id: "text-1",
    channelId: "ch-1",
    senderId,
    content: "done",
    type: "text",
    isPinned: false,
    isEdited: false,
    isDeleted: false,
    createdAt,
    updatedAt: createdAt,
  };
}

function makeAgentTextMessage(
  agentEventType: "writing" | "thinking",
  createdAt: string,
): Message {
  return {
    ...makeTextMessage("bot-1", createdAt),
    id: `${agentEventType}-${createdAt}`,
    metadata: { agentEventType, status: "completed" },
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

  it("removes a warming bot when a regular reply arrives without lifecycle events", () => {
    const state: BotThinkingStatus[] = [{ botId: "bot-1", phase: "warming" }];

    expect(applyBotThinkingMessage(state, makeTextMessage())).toEqual([]);
  });

  it("removes a working bot when a regular final reply arrives before agent_end", () => {
    const state: BotThinkingStatus[] = [{ botId: "bot-1", phase: "working" }];

    expect(applyBotThinkingMessage(state, makeTextMessage())).toEqual([]);
  });

  it("ignores already-loaded messages from before the local warmup started", () => {
    const state = startBotThinkingStatuses(
      ["bot-1"],
      new Date("2026-01-01T00:00:10Z").getTime(),
    );

    expect(
      syncBotThinkingStatusesWithMessages(state, [
        makeTextMessage("bot-1", "2026-01-01T00:00:05Z"),
      ]),
    ).toEqual(state);
  });

  it("syncs loaded agent_end messages even when the websocket event was missed", () => {
    const state = startBotThinkingStatuses(
      ["bot-1"],
      new Date("2026-01-01T00:00:10Z").getTime(),
    );

    expect(
      syncBotThinkingStatusesWithMessages(state, [
        makeTrackingMessage("agent_end", "bot-1", "2026-01-01T00:00:20Z"),
      ]),
    ).toEqual([]);
  });

  it("syncs loaded regular replies when no agent_end message is present", () => {
    const state = startBotThinkingStatuses(
      ["bot-1"],
      new Date("2026-01-01T00:00:10Z").getTime(),
    );

    expect(
      syncBotThinkingStatusesWithMessages(state, [
        makeTrackingMessage("agent_start", "bot-1", "2026-01-01T00:00:12Z"),
        makeTextMessage("bot-1", "2026-01-01T00:00:20Z"),
      ]),
    ).toEqual([]);
  });

  it("clears after the real routine clarification sequence when agent_end is present", () => {
    const state = startBotThinkingStatuses(
      ["bot-1"],
      new Date("2026-05-05T14:45:30.941Z").getTime(),
    );

    expect(
      syncBotThinkingStatusesWithMessages(state, [
        makeTrackingMessage("agent_start", "bot-1", "2026-05-05T14:49:00.916Z"),
        makeAgentTextMessage("writing", "2026-05-05T14:49:05.645Z"),
        makeAgentTextMessage("thinking", "2026-05-05T14:49:05.747Z"),
        makeTrackingMessage("agent_end", "bot-1", "2026-05-05T14:49:05.850Z"),
      ]),
    ).toEqual([]);
  });
});

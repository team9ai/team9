import { describe, expect, it } from "vitest";
import {
  buildTeam9StreamDisplayItems,
  type Team9ThinkingItemData,
} from "./streaming-display-adapter";
import type { StreamingMessage } from "@/stores/useStreamingStore";

function makeStream(
  overrides: Partial<StreamingMessage> = {},
): StreamingMessage {
  return {
    streamId: "stream-1",
    channelId: "channel-1",
    senderId: "bot-1",
    content: "first replysecond reply",
    thinking: "first thinkingsecond thinking",
    isThinking: false,
    isStreaming: true,
    startedAt: 1_000,
    parts: [
      {
        id: "stream-1-0",
        type: "thinking",
        content: "first thinking",
        startedAt: 1_000,
        isStreaming: false,
        durationMs: 1_000,
      },
      {
        id: "stream-1-1",
        type: "content",
        content: "first reply",
        startedAt: 2_000,
        isStreaming: false,
      },
      {
        id: "stream-1-2",
        type: "thinking",
        content: "second thinking",
        startedAt: 3_000,
        isStreaming: false,
        durationMs: 2_000,
      },
      {
        id: "stream-1-3",
        type: "content",
        content: "second reply",
        startedAt: 4_000,
        isStreaming: true,
      },
    ],
    ...overrides,
  };
}

describe("buildTeam9StreamDisplayItems", () => {
  it("maps interleaved thinking and content parts to shared display items", () => {
    const items = buildTeam9StreamDisplayItems(makeStream());

    expect(items.map((item) => item.kind)).toEqual([
      "thinking",
      "agent-message",
      "thinking",
      "agent-message",
    ]);
    expect(items.map((item) => item.id)).toEqual([
      "stream-1-0",
      "stream-1-1",
      "stream-1-2",
      "stream-1-3",
    ]);
    expect(items.map((item) => item.timestamp)).toEqual([
      1_000, 2_000, 3_000, 4_000,
    ]);
  });

  it("keeps a synthetic thinking item for active streams before text arrives", () => {
    const items = buildTeam9StreamDisplayItems(
      makeStream({
        content: "",
        thinking: "",
        isThinking: false,
        parts: [],
      }),
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "thinking",
      id: "stream-1:thinking",
      timestamp: 1_000,
    });
  });

  it("does not create an empty thinking item for text-only streams", () => {
    const items = buildTeam9StreamDisplayItems(
      makeStream({
        content: "plain reply",
        thinking: "",
        isThinking: false,
        parts: [],
      }),
    );

    expect(items.map((item) => item.kind)).toEqual(["agent-message"]);
    expect(items[0]).toMatchObject({
      kind: "agent-message",
      id: "stream-1:content",
      timestamp: 1_000,
    });
  });

  it("hides completed pre-content thinking when no text has appeared", () => {
    const items = buildTeam9StreamDisplayItems(
      makeStream({
        content: "",
        thinking: "tool planning",
        parts: [
          {
            id: "stream-1-0",
            type: "thinking",
            content: "tool planning",
            startedAt: 1_000,
            isStreaming: false,
            durationMs: 12_000,
          },
        ],
      }),
    );

    expect(items).toEqual([]);
  });

  it("suppresses ordinary thinking rows for deep research streams", () => {
    const items = buildTeam9StreamDisplayItems(
      makeStream({
        content: "",
        thinking: "research thinking",
        metadata: {
          longRunning: true,
          deepResearch: {
            kind: "report",
            status: "running",
          },
        },
      }),
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "agent-message",
      id: "stream-1:deep-research",
      timestamp: 1_000,
    });
    expect((items[0].data as StreamingMessage).thinking).toBe("");
  });

  it("stores Team9 thinking render data on thinking display items", () => {
    const items = buildTeam9StreamDisplayItems(makeStream());
    const thinkingData = items[0].data as Team9ThinkingItemData;

    expect(thinkingData).toMatchObject({
      thinking: "first thinking",
      startedAt: 1_000,
      isLive: false,
      durationMs: 1_000,
    });
    expect(thinkingData.stream.streamId).toBe("stream-1");
  });
});

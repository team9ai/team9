import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStreamingStore } from "./useStreamingStore";

describe("useStreamingStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useStreamingStore.setState({ streams: new Map() });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps thinking and text as ordered parts when they alternate in one stream", () => {
    useStreamingStore.getState().startStream({
      streamId: "stream-1",
      channelId: "channel-1",
      senderId: "bot-1",
      startedAt: 1000,
    });

    useStreamingStore
      .getState()
      .setThinkingContent("stream-1", "first thinking");
    useStreamingStore.getState().setStreamContent("stream-1", "first reply");
    useStreamingStore
      .getState()
      .setThinkingContent("stream-1", "first thinkingsecond thinking");
    useStreamingStore
      .getState()
      .setStreamContent("stream-1", "first replysecond reply");

    const stream = useStreamingStore.getState().streams.get("stream-1");
    expect(stream?.parts.map((part) => [part.type, part.content])).toEqual([
      ["thinking", "first thinking"],
      ["content", "first reply"],
      ["thinking", "second thinking"],
      ["content", "second reply"],
    ]);
  });

  it("preserves metadata from streaming_start", () => {
    useStreamingStore.getState().startStream({
      streamId: "stream-1",
      channelId: "channel-1",
      senderId: "bot-1",
      startedAt: 1000,
      metadata: {
        agentEventType: "tool_call",
        status: "running",
        toolCallId: "tc-1",
      },
    });

    const stream = useStreamingStore.getState().streams.get("stream-1");
    expect(stream?.metadata).toEqual({
      agentEventType: "tool_call",
      status: "running",
      toolCallId: "tc-1",
    });
  });

  it("updates the active part instead of creating duplicates for same-phase deltas", () => {
    useStreamingStore.getState().startStream({
      streamId: "stream-1",
      channelId: "channel-1",
      senderId: "bot-1",
      startedAt: 1000,
    });

    useStreamingStore.getState().setThinkingContent("stream-1", "think");
    useStreamingStore.getState().setThinkingContent("stream-1", "thinking");
    useStreamingStore.getState().setStreamContent("stream-1", "hel");
    useStreamingStore.getState().setStreamContent("stream-1", "hello");

    const stream = useStreamingStore.getState().streams.get("stream-1");
    expect(stream?.parts.map((part) => [part.type, part.content])).toEqual([
      ["thinking", "thinking"],
      ["content", "hello"],
    ]);
  });
});

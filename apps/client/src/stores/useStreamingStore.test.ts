import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStreamingStore } from "./useStreamingStore";

describe("useStreamingStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
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

  it("merges streaming_start metadata into an existing race-created stream", () => {
    useStreamingStore.getState().startStream({
      streamId: "stream-1",
      channelId: "channel-1",
      senderId: "bot-1",
      startedAt: 1000,
    });
    useStreamingStore.getState().setStreamContent("stream-1", "hello");

    useStreamingStore.getState().startStream({
      streamId: "stream-1",
      channelId: "channel-1",
      senderId: "bot-1",
      startedAt: 2000,
      metadata: {
        agentEventType: "tool_call",
        status: "running",
        toolCallId: "tc-1",
      },
    });

    const stream = useStreamingStore.getState().streams.get("stream-1");
    expect(stream?.content).toBe("hello");
    expect(stream?.parts.map((part) => [part.type, part.content])).toEqual([
      ["content", "hello"],
    ]);
    expect(stream?.metadata).toEqual({
      agentEventType: "tool_call",
      status: "running",
      toolCallId: "tc-1",
    });
    expect(stream?.startedAt).toBe(1000);
  });

  it("merges streaming metadata deltas without recording intermediate parts", () => {
    useStreamingStore.getState().startStream({
      streamId: "stream-1",
      channelId: "channel-1",
      senderId: "bot-1",
      startedAt: 1000,
      metadata: {
        agentEventType: "tool_call",
        status: "running",
        toolCallId: "tc-1",
        toolName: "RunScript",
        toolArgsText: '{"cmd":"pnpm',
      },
    });

    useStreamingStore.getState().setStreamMetadata("stream-1", {
      toolArgsText: '{"cmd":"pnpm test -- --runInBand"}',
      toolPhase: "executing",
    });

    const stream = useStreamingStore.getState().streams.get("stream-1");
    expect(stream?.parts).toEqual([]);
    expect(stream?.metadata).toEqual({
      agentEventType: "tool_call",
      status: "running",
      toolCallId: "tc-1",
      toolName: "RunScript",
      toolArgsText: '{"cmd":"pnpm test -- --runInBand"}',
      toolPhase: "executing",
    });
  });

  it("appends tool arg deltaData and restores accumulated metadata after refresh", () => {
    useStreamingStore.getState().startStream({
      streamId: "stream-1",
      channelId: "channel-1",
      senderId: "bot-1",
      startedAt: 1000,
      metadata: {
        agentEventType: "tool_call",
        status: "running",
        toolCallId: "tc-1",
        toolName: "RunScript",
      },
    });

    useStreamingStore.getState().setStreamMetadata("stream-1", {
      deltaData: { toolArgsText: '{"cmd":"pnpm' },
      toolPhase: "args_streaming",
    });
    useStreamingStore.getState().setStreamMetadata("stream-1", {
      deltaData: { toolArgsText: ' test"}' },
      toolPhase: "args_streaming",
    });

    expect(
      useStreamingStore.getState().streams.get("stream-1")?.metadata,
    ).toEqual({
      agentEventType: "tool_call",
      status: "running",
      toolCallId: "tc-1",
      toolName: "RunScript",
      toolArgsText: '{"cmd":"pnpm test"}',
      toolPhase: "args_streaming",
    });

    // Simulate a page refresh: Zustand state is gone, sessionStorage remains.
    useStreamingStore.setState({ streams: new Map() });
    useStreamingStore.getState().startStream({
      streamId: "stream-1",
      channelId: "channel-1",
      senderId: "bot-1",
      startedAt: 2000,
    });
    useStreamingStore.getState().setStreamMetadata("stream-1", {
      deltaData: { toolArgsText: "\n" },
      toolPhase: "args_streaming",
    });

    expect(
      useStreamingStore.getState().streams.get("stream-1")?.metadata,
    ).toEqual({
      agentEventType: "tool_call",
      status: "running",
      toolCallId: "tc-1",
      toolName: "RunScript",
      toolArgsText: '{"cmd":"pnpm test"}\n',
      toolPhase: "args_streaming",
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

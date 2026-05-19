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

  it("preserves deep research progress when later metadata only updates phase", () => {
    useStreamingStore.getState().startStream({
      streamId: "stream-1",
      channelId: "channel-1",
      senderId: "bot-1",
      startedAt: 1000,
      metadata: {
        longRunning: true,
        deepResearch: {
          status: "running",
          phase: "searching",
          progress: {
            phase: "searching",
            sources: [{ url: "https://example.com/a", title: "A" }],
            counts: { websites: 1 },
          },
        },
      },
    });

    useStreamingStore.getState().setStreamMetadata("stream-1", {
      deepResearch: {
        status: "running",
        phase: "synthesizing",
      },
    });

    expect(
      useStreamingStore.getState().streams.get("stream-1")?.metadata,
    ).toEqual({
      longRunning: true,
      deepResearch: {
        status: "running",
        phase: "synthesizing",
        progress: {
          phase: "searching",
          sources: [{ url: "https://example.com/a", title: "A" }],
          counts: { websites: 1 },
        },
      },
    });
  });

  it("merges deep research progress snapshots without regressing process details", () => {
    useStreamingStore.getState().startStream({
      streamId: "stream-1",
      channelId: "channel-1",
      senderId: "bot-1",
      startedAt: 1000,
      metadata: {
        longRunning: true,
        deepResearch: {
          status: "running",
          phase: "searching",
          progress: {
            phase: "searching",
            thoughts: [
              {
                id: "0",
                title: "梳理研究脉络",
                text: "longer stable thought",
                status: "running",
              },
            ],
            sources: [
              {
                id: "https://example.com/a",
                url: "https://example.com/a",
                title: "A",
              },
            ],
            queries: ["q1"],
            counts: { websites: 1 },
          },
        },
      },
    });

    useStreamingStore.getState().setStreamMetadata("stream-1", {
      deepResearch: {
        status: "running",
        phase: "running",
        progress: {
          phase: "planning",
          thoughts: [
            {
              id: "0",
              title: "梳理研究脉络",
              text: "short",
              status: "completed",
            },
            {
              id: "1",
              title: "识别关键问题",
              text: "new thought",
              status: "running",
            },
          ],
          sources: [
            {
              id: "https://example.com/a",
              url: "https://example.com/a",
              title: "A updated",
            },
            {
              id: "https://example.com/b",
              url: "https://example.com/b",
              title: "B",
            },
          ],
          queries: ["q1", "q2"],
          counts: { searchQueries: 2 },
        },
      },
    });

    expect(
      useStreamingStore.getState().streams.get("stream-1")?.metadata,
    ).toMatchObject({
      deepResearch: {
        phase: "running",
        progress: {
          phase: "planning",
          thoughts: [
            {
              id: "0",
              text: "longer stable thought",
              status: "completed",
            },
            {
              id: "1",
              text: "new thought",
              status: "running",
            },
          ],
          sources: [
            {
              id: "https://example.com/a",
              title: "A updated",
            },
            {
              id: "https://example.com/b",
              title: "B",
            },
          ],
          queries: ["q1", "q2"],
          counts: { websites: 1, searchQueries: 2 },
        },
      },
    });
  });

  it("closes active thinking when tool call metadata starts streaming", () => {
    vi.setSystemTime(1000);
    useStreamingStore.getState().startStream({
      streamId: "stream-1",
      channelId: "channel-1",
      senderId: "bot-1",
      startedAt: 1000,
    });
    useStreamingStore.getState().setThinkingContent("stream-1", "thinking");

    vi.setSystemTime(3500);
    useStreamingStore.getState().setStreamMetadata("stream-1", {
      agentEventType: "tool_call",
      status: "running",
      toolCallId: "tc-1",
      toolName: "run_command",
      toolArgsText: '{"command":"echo',
      toolPhase: "args_streaming",
    });

    const stream = useStreamingStore.getState().streams.get("stream-1");
    expect(stream?.isThinking).toBe(false);
    expect(stream?.parts).toEqual([
      {
        id: "stream-1-0",
        type: "thinking",
        content: "thinking",
        startedAt: 1000,
        isStreaming: false,
        durationMs: 2500,
      },
    ]);
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

  it("restores an active stream snapshot after a channel reload", () => {
    useStreamingStore.getState().restoreStream({
      streamId: "stream-1",
      channelId: "channel-1",
      senderId: "bot-1",
      startedAt: 1000,
      thinking: "research path",
      content: "partial report",
      metadata: {
        longRunning: true,
        deepResearch: {
          kind: "report",
          status: "running",
          progress: {
            thoughts: ["checking sources"],
          },
        },
      },
    });

    const stream = useStreamingStore.getState().streams.get("stream-1");
    expect(stream).toMatchObject({
      streamId: "stream-1",
      channelId: "channel-1",
      senderId: "bot-1",
      content: "partial report",
      thinking: "research path",
      isStreaming: true,
      isThinking: false,
      metadata: {
        longRunning: true,
        deepResearch: {
          kind: "report",
          status: "running",
          progress: {
            thoughts: ["checking sources"],
          },
        },
      },
    });
    expect(stream?.parts.map((part) => [part.type, part.content])).toEqual([
      ["thinking", "research path"],
      ["content", "partial report"],
    ]);
  });

  it("refreshes stale-stream cleanup while ordinary stream updates keep arriving", () => {
    useStreamingStore.getState().startStream({
      streamId: "stream-1",
      channelId: "channel-1",
      senderId: "bot-1",
      startedAt: 1000,
    });

    vi.advanceTimersByTime(119_000);
    useStreamingStore.getState().setStreamContent("stream-1", "partial report");

    vi.advanceTimersByTime(119_000);
    expect(useStreamingStore.getState().streams.has("stream-1")).toBe(true);

    useStreamingStore.getState().setStreamMetadata("stream-1", {
      agentEventType: "writing",
      status: "running",
    });

    vi.advanceTimersByTime(119_000);
    expect(useStreamingStore.getState().streams.has("stream-1")).toBe(true);

    vi.advanceTimersByTime(1_001);
    expect(useStreamingStore.getState().streams.has("stream-1")).toBe(false);
  });

  it("keeps long-running deep research streams past the ordinary stale timeout", () => {
    useStreamingStore.getState().startStream({
      streamId: "stream-1",
      channelId: "channel-1",
      senderId: "bot-1",
      startedAt: 1000,
      metadata: {
        longRunning: true,
        deepResearch: {
          status: "running",
          phase: "started",
        },
      },
    });

    vi.advanceTimersByTime(120_001);
    expect(useStreamingStore.getState().streams.has("stream-1")).toBe(true);

    vi.advanceTimersByTime(90 * 60_000 - 120_001);
    expect(useStreamingStore.getState().streams.has("stream-1")).toBe(false);
  });
});

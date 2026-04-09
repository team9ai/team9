import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import {
  TrackingEventItem,
  formatDuration,
  buildThinkingStats,
} from "../TrackingEventItem";
import type { AgentEventMetadata } from "@/types/im";

describe("TrackingEventItem", () => {
  it("should render a thinking event label (body hidden until expanded)", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "thinking",
      status: "completed",
    };
    render(
      <TrackingEventItem metadata={meta} content="Analyzing the code..." />,
    );

    expect(screen.getByText("Thinking")).toBeInTheDocument();
    // Thinking body should not be visible in the collapsed default state.
    expect(screen.queryByText("Analyzing the code...")).not.toBeInTheDocument();
  });

  it("should render writing label for writing event type", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "writing",
      status: "running",
    };
    render(<TrackingEventItem metadata={meta} content="some content" />);

    expect(screen.getByText("Writing")).toBeInTheDocument();
  });

  it("should render tool name as content and localized label for tool_call events", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "tool_call",
      status: "completed",
      toolName: "SearchFiles",
    };
    render(<TrackingEventItem metadata={meta} content="raw content" />);

    // Unknown tool name falls back to operation-type label ("invoke_tool")
    expect(screen.getByText("工具调用完成")).toBeInTheDocument();
    expect(screen.getByText("SearchFiles")).toBeInTheDocument();
    expect(screen.queryByText("raw content")).not.toBeInTheDocument();
    // Old hardcoded label should no longer be used
    expect(screen.queryByText("Calling")).not.toBeInTheDocument();
  });

  it("should fall back to content when toolName is not provided", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "tool_call",
      status: "completed",
    };
    render(<TrackingEventItem metadata={meta} content="fallback content" />);

    expect(screen.getByText("fallback content")).toBeInTheDocument();
  });

  it("should apply running status styles (animate-pulse)", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "writing",
      status: "running",
    };
    const { container } = render(
      <TrackingEventItem metadata={meta} content="writing..." />,
    );

    const dot = container.querySelector(".animate-pulse.bg-emerald-500");
    expect(dot).toBeInTheDocument();
  });

  it("should apply failed status styles (red dot)", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "error",
      status: "failed",
    };
    const { container } = render(
      <TrackingEventItem metadata={meta} content="Error occurred" />,
    );

    const dot = container.querySelector(".bg-red-500");
    expect(dot).toBeInTheDocument();
    expect(screen.getByText("Error")).toBeInTheDocument();
  });

  it("should show streaming cursor when isStreaming is true", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "writing",
      status: "completed", // status overridden by isStreaming
    };
    const { container } = render(
      <TrackingEventItem metadata={meta} content="streaming..." isStreaming />,
    );

    // Streaming forces running status, so dot should pulse
    const dot = container.querySelector(".animate-pulse.bg-emerald-500");
    expect(dot).toBeInTheDocument();
  });

  it("should render all non-hidden event type labels correctly", () => {
    const eventTypes: Array<{
      type: AgentEventMetadata["agentEventType"];
      label: string;
    }> = [
      { type: "thinking", label: "Thinking" },
      { type: "writing", label: "Writing" },
      // tool_call uses getLabel -> operationLabels.invoke_tool.success
      { type: "tool_call", label: "工具调用完成" },
      { type: "tool_result", label: "Result" },
      { type: "agent_start", label: "Started" },
      { type: "agent_end", label: "Completed" },
      { type: "error", label: "Error" },
    ];

    for (const { type, label } of eventTypes) {
      const { unmount } = render(
        <TrackingEventItem
          metadata={{ agentEventType: type, status: "completed" }}
          content="test"
        />,
      );
      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
  });

  describe("turn_separator hiding", () => {
    it("should render null for turn_separator events", () => {
      const meta: AgentEventMetadata = {
        agentEventType: "turn_separator",
        status: "completed",
      };
      const { container } = render(
        <TrackingEventItem metadata={meta} content="Turn 1" />,
      );
      expect(container.firstChild).toBeNull();
    });

    it("should render null for turn_separator regardless of status", () => {
      const statuses: AgentEventMetadata["status"][] = [
        "running",
        "completed",
        "failed",
        "resolved",
        "timeout",
        "cancelled",
      ];
      for (const status of statuses) {
        const { container, unmount } = render(
          <TrackingEventItem
            metadata={{ agentEventType: "turn_separator", status }}
            content="Turn marker"
          />,
        );
        expect(container.firstChild).toBeNull();
        unmount();
      }
    });

    it("should render null for turn_separator even when isStreaming", () => {
      const meta: AgentEventMetadata = {
        agentEventType: "turn_separator",
        status: "running",
      };
      const { container } = render(
        <TrackingEventItem metadata={meta} content="Turn 2" isStreaming />,
      );
      expect(container.firstChild).toBeNull();
      // Content from a hidden turn separator should never leak to the DOM
      expect(screen.queryByText("Turn 2")).not.toBeInTheDocument();
    });

    it("should render null for turn_separator even when collapsible", () => {
      const meta: AgentEventMetadata = {
        agentEventType: "turn_separator",
        status: "completed",
      };
      const { container } = render(
        <TrackingEventItem
          metadata={meta}
          content="Turn 3 separator body"
          collapsible
        />,
      );
      expect(container.firstChild).toBeNull();
    });
  });

  describe("tool_call label mapping via getLabel", () => {
    it("should use localized loading label for known tool with running status", () => {
      const meta: AgentEventMetadata = {
        agentEventType: "tool_call",
        status: "running",
        toolName: "send_message",
      };
      render(<TrackingEventItem metadata={meta} content="" />);
      expect(screen.getByText("正在发送消息")).toBeInTheDocument();
    });

    it("should use localized success label for known tool with completed status", () => {
      const meta: AgentEventMetadata = {
        agentEventType: "tool_call",
        status: "completed",
        toolName: "send_message",
      };
      render(<TrackingEventItem metadata={meta} content="" />);
      expect(screen.getByText("消息发送完成")).toBeInTheDocument();
    });

    it("should use localized error label for known tool with failed status", () => {
      const meta: AgentEventMetadata = {
        agentEventType: "tool_call",
        status: "failed",
        toolName: "send_message",
      };
      render(<TrackingEventItem metadata={meta} content="" />);
      expect(screen.getByText("消息发送失败")).toBeInTheDocument();
    });

    it("should treat resolved status as success for tool_call labels", () => {
      const meta: AgentEventMetadata = {
        agentEventType: "tool_call",
        status: "resolved",
        toolName: "search_docs",
      };
      render(<TrackingEventItem metadata={meta} content="" />);
      expect(screen.getByText("文档搜索完成")).toBeInTheDocument();
    });

    it("should treat timeout status as error for tool_call labels", () => {
      const meta: AgentEventMetadata = {
        agentEventType: "tool_call",
        status: "timeout",
        toolName: "generate_reply",
      };
      render(<TrackingEventItem metadata={meta} content="" />);
      expect(screen.getByText("回复生成失败")).toBeInTheDocument();
    });

    it("should treat cancelled status as error for tool_call labels", () => {
      const meta: AgentEventMetadata = {
        agentEventType: "tool_call",
        status: "cancelled",
        toolName: "send_message",
      };
      render(<TrackingEventItem metadata={meta} content="" />);
      expect(screen.getByText("消息发送失败")).toBeInTheDocument();
    });

    it("should force loading label when isStreaming overrides status", () => {
      const meta: AgentEventMetadata = {
        agentEventType: "tool_call",
        status: "completed", // isStreaming should flip this to running -> loading
        toolName: "send_message",
      };
      render(<TrackingEventItem metadata={meta} content="" isStreaming />);
      expect(screen.getByText("正在发送消息")).toBeInTheDocument();
      expect(screen.queryByText("消息发送完成")).not.toBeInTheDocument();
    });

    it("should fall back to operation-type label for unknown tool names", () => {
      const meta: AgentEventMetadata = {
        agentEventType: "tool_call",
        status: "running",
        toolName: "UnknownCustomTool",
      };
      render(<TrackingEventItem metadata={meta} content="" />);
      expect(screen.getByText("正在调用工具")).toBeInTheDocument();
    });

    it("should fall back to operation-type label when toolName is missing", () => {
      const meta: AgentEventMetadata = {
        agentEventType: "tool_call",
        status: "completed",
      };
      render(<TrackingEventItem metadata={meta} content="fallback content" />);
      expect(screen.getByText("工具调用完成")).toBeInTheDocument();
    });

    it("should not apply getLabel to non-tool_call events", () => {
      // thinking events should retain the original EVENT_LABELS mapping
      render(
        <TrackingEventItem
          metadata={{ agentEventType: "thinking", status: "completed" }}
          content="Deep thought"
        />,
      );
      expect(screen.getByText("Thinking")).toBeInTheDocument();
      expect(screen.queryByText("工具调用完成")).not.toBeInTheDocument();
    });
  });
});

describe("TrackingEventItem - collapsible", () => {
  it("should show truncated content with ... when collapsible", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "tool_result",
      status: "completed",
    };
    render(
      <TrackingEventItem
        metadata={meta}
        content='{"results": [1,2,3], "count": 42, "categories": {"ui": 45, "perf": 38, "feat": 32}}'
        collapsible
      />,
    );

    expect(screen.getByText(/\.\.\./)).toBeInTheDocument();
  });

  it("should not show expanded content by default", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "tool_result",
      status: "completed",
    };
    render(
      <TrackingEventItem
        metadata={meta}
        content='{"full": "content"}'
        collapsible
      />,
    );

    const expandedBlocks = document.querySelectorAll(
      "[data-testid='expanded-content']",
    );
    expect(expandedBlocks).toHaveLength(0);
  });

  it("should expand content on click", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "tool_result",
      status: "completed",
    };
    render(
      <TrackingEventItem
        metadata={meta}
        content='{"full": "content"}'
        collapsible
      />,
    );

    fireEvent.click(screen.getByText("Result"));
    expect(screen.getByTestId("expanded-content")).toBeInTheDocument();
  });

  it("should use purple label for thinking type", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "thinking",
      status: "completed",
    };
    const { container } = render(
      <TrackingEventItem metadata={meta} content="thinking..." />,
    );

    const label = container.querySelector(".text-purple-400");
    expect(label).toBeInTheDocument();
  });
});

describe("formatDuration helper", () => {
  it("formats sub-minute durations in seconds", () => {
    expect(formatDuration(45_000)).toBe("45秒");
  });

  it("formats exactly 59 seconds without promoting to minutes", () => {
    expect(formatDuration(59_999)).toBe("59秒");
  });

  it("formats exactly 60 seconds as 1分0秒", () => {
    expect(formatDuration(60_000)).toBe("1分0秒");
  });

  it("formats >= 60 seconds as Chinese 分秒 format", () => {
    expect(formatDuration(123_000)).toBe("2分3秒");
  });

  it("formats whole minutes with 0秒 suffix", () => {
    expect(formatDuration(120_000)).toBe("2分0秒");
  });

  it("floors millisecond values to whole seconds", () => {
    expect(formatDuration(45_999)).toBe("45秒");
  });

  it("clamps negative values to 0秒", () => {
    expect(formatDuration(-5_000)).toBe("0秒");
  });

  it("returns 0秒 for zero", () => {
    expect(formatDuration(0)).toBe("0秒");
  });
});

describe("buildThinkingStats helper", () => {
  it("returns bare Thinking when no stats available", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "thinking",
      status: "completed",
    };
    expect(buildThinkingStats(meta, false)).toBe("Thinking");
  });

  it("uses totalTokens when available", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "thinking",
      status: "completed",
      totalTokens: 1200,
      outputTokens: 800,
    };
    expect(buildThinkingStats(meta, false)).toBe("Thinking (1200 tokens)");
  });

  it("falls back to outputTokens when totalTokens missing", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "thinking",
      status: "completed",
      outputTokens: 512,
    };
    expect(buildThinkingStats(meta, false)).toBe("Thinking (512 tokens)");
  });

  it("ignores zero/negative token counts", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "thinking",
      status: "completed",
      totalTokens: 0,
    };
    expect(buildThinkingStats(meta, false)).toBe("Thinking");
  });

  it("includes only duration when tokens missing", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "thinking",
      status: "completed",
      durationMs: 123_000,
    };
    expect(buildThinkingStats(meta, false)).toBe("Thinking (2分3秒)");
  });

  it("combines tokens and duration when both present", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "thinking",
      status: "completed",
      totalTokens: 1200,
      durationMs: 123_000,
    };
    expect(buildThinkingStats(meta, false)).toBe(
      "Thinking (1200 tokens, 2分3秒)",
    );
  });

  it("computes live elapsed from startedAt when streaming", () => {
    const now = 1_700_000_000_000;
    const started = new Date(now - 45_000).toISOString();
    const meta: AgentEventMetadata = {
      agentEventType: "thinking",
      status: "running",
      startedAt: started,
    };
    expect(buildThinkingStats(meta, true, now)).toBe("Thinking (45秒)");
  });

  it("combines live elapsed with tokens when streaming", () => {
    const now = 2_000_000_000_000;
    const started = new Date(now - 30_000).toISOString();
    const meta: AgentEventMetadata = {
      agentEventType: "thinking",
      status: "running",
      totalTokens: 300,
      startedAt: started,
    };
    expect(buildThinkingStats(meta, true, now)).toBe(
      "Thinking (300 tokens, 30秒)",
    );
  });

  it("omits live elapsed when startedAt is invalid", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "thinking",
      status: "running",
      startedAt: "not-a-date",
    };
    expect(buildThinkingStats(meta, true, Date.now())).toBe("Thinking");
  });

  it("omits live elapsed when startedAt missing while streaming", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "thinking",
      status: "running",
      totalTokens: 10,
    };
    expect(buildThinkingStats(meta, true, Date.now())).toBe(
      "Thinking (10 tokens)",
    );
  });

  it("skips live elapsed of 0 (same-instant start)", () => {
    const now = 1_700_000_000_000;
    const meta: AgentEventMetadata = {
      agentEventType: "thinking",
      status: "running",
      startedAt: new Date(now).toISOString(),
    };
    expect(buildThinkingStats(meta, true, now)).toBe("Thinking");
  });

  it("prefers durationMs over startedAt when not streaming", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "thinking",
      status: "completed",
      durationMs: 45_000,
      startedAt: new Date(0).toISOString(),
    };
    expect(buildThinkingStats(meta, false, Date.now())).toBe("Thinking (45秒)");
  });
});

describe("thinking event display", () => {
  it("does not render a status dot for thinking events", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "thinking",
      status: "completed",
    };
    const { container } = render(
      <TrackingEventItem metadata={meta} content="Deep thought" />,
    );

    // The status dot is a w-2 h-2 rounded-full element. Thinking should skip it.
    const dot = container.querySelector(".w-2.h-2.rounded-full");
    expect(dot).not.toBeInTheDocument();
  });

  it("renders a status dot for non-thinking events (regression)", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "writing",
      status: "completed",
    };
    const { container } = render(
      <TrackingEventItem metadata={meta} content="writing..." />,
    );

    const dot = container.querySelector(".w-2.h-2.rounded-full");
    expect(dot).toBeInTheDocument();
  });

  it("is collapsible by default without collapsible prop", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "thinking",
      status: "completed",
      thinking: "Hidden reasoning body",
    };
    const { container } = render(
      <TrackingEventItem metadata={meta} content="fallback" />,
    );

    // Chevron is rendered (lucide ChevronRight is an <svg>).
    const chevron = container.querySelector("svg");
    expect(chevron).toBeInTheDocument();
    // And the main row should carry the cursor-pointer class.
    const row = container.querySelector(".cursor-pointer");
    expect(row).toBeInTheDocument();
  });

  it("is collapsed by default for thinking events", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "thinking",
      status: "completed",
      thinking: "Deep thought body",
    };
    render(<TrackingEventItem metadata={meta} content="ignored" />);

    expect(screen.queryByTestId("expanded-content")).not.toBeInTheDocument();
    expect(screen.queryByText("Deep thought body")).not.toBeInTheDocument();
  });

  it("shows full label with tokens and duration when both present", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "thinking",
      status: "completed",
      totalTokens: 1200,
      durationMs: 123_000,
    };
    render(<TrackingEventItem metadata={meta} content="" />);

    expect(
      screen.getByText("Thinking (1200 tokens, 2分3秒)"),
    ).toBeInTheDocument();
  });

  it("shows tokens-only label when duration missing", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "thinking",
      status: "completed",
      totalTokens: 1200,
    };
    render(<TrackingEventItem metadata={meta} content="" />);

    expect(screen.getByText("Thinking (1200 tokens)")).toBeInTheDocument();
  });

  it("shows duration-only label when tokens missing", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "thinking",
      status: "completed",
      durationMs: 123_000,
    };
    render(<TrackingEventItem metadata={meta} content="" />);

    expect(screen.getByText("Thinking (2分3秒)")).toBeInTheDocument();
  });

  it("shows bare Thinking label when nothing is available", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "thinking",
      status: "completed",
    };
    render(<TrackingEventItem metadata={meta} content="" />);

    expect(screen.getByText("Thinking")).toBeInTheDocument();
  });

  it("formats sub-minute durations as 秒", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "thinking",
      status: "completed",
      durationMs: 45_000,
    };
    render(<TrackingEventItem metadata={meta} content="" />);

    expect(screen.getByText("Thinking (45秒)")).toBeInTheDocument();
  });

  it("formats durations >= 60s as 分秒", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "thinking",
      status: "completed",
      durationMs: 125_000,
    };
    render(<TrackingEventItem metadata={meta} content="" />);

    expect(screen.getByText("Thinking (2分5秒)")).toBeInTheDocument();
  });

  it("formats whole minutes as 2分0秒", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "thinking",
      status: "completed",
      durationMs: 120_000,
    };
    render(<TrackingEventItem metadata={meta} content="" />);

    expect(screen.getByText("Thinking (2分0秒)")).toBeInTheDocument();
  });

  it("expands on click and shows metadata.thinking body", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "thinking",
      status: "completed",
      totalTokens: 100,
      thinking: "Metadata thinking body takes precedence",
    };
    render(<TrackingEventItem metadata={meta} content="content fallback" />);

    fireEvent.click(screen.getByText("Thinking (100 tokens)"));
    const expanded = screen.getByTestId("expanded-content");
    expect(expanded).toBeInTheDocument();
    expect(expanded).toHaveTextContent(
      "Metadata thinking body takes precedence",
    );
    expect(expanded).not.toHaveTextContent("content fallback");
  });

  it("falls back to content prop when metadata.thinking missing", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "thinking",
      status: "completed",
    };
    render(
      <TrackingEventItem metadata={meta} content="Content prop body used" />,
    );

    fireEvent.click(screen.getByText("Thinking"));
    const expanded = screen.getByTestId("expanded-content");
    expect(expanded).toBeInTheDocument();
    expect(expanded).toHaveTextContent("Content prop body used");
  });

  it("falls back to content prop when metadata.thinking is empty string", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "thinking",
      status: "completed",
      thinking: "",
    };
    render(
      <TrackingEventItem metadata={meta} content="Primary content body" />,
    );

    fireEvent.click(screen.getByText("Thinking"));
    const expanded = screen.getByTestId("expanded-content");
    expect(expanded).toHaveTextContent("Primary content body");
  });

  it("toggles expansion back on second click", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "thinking",
      status: "completed",
      thinking: "Hidden reasoning",
    };
    render(<TrackingEventItem metadata={meta} content="" />);

    const label = screen.getByText("Thinking");
    fireEvent.click(label);
    expect(screen.getByTestId("expanded-content")).toBeInTheDocument();
    fireEvent.click(label);
    expect(screen.queryByTestId("expanded-content")).not.toBeInTheDocument();
  });

  describe("live streaming elapsed updates", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("updates elapsed label as time advances while streaming", () => {
      const fixedNow = new Date("2026-04-09T10:00:00.000Z").getTime();
      vi.setSystemTime(fixedNow);

      const meta: AgentEventMetadata = {
        agentEventType: "thinking",
        status: "running",
        startedAt: new Date(fixedNow - 5_000).toISOString(),
      };
      render(<TrackingEventItem metadata={meta} content="" isStreaming />);

      // Initial render: 5 seconds elapsed.
      expect(screen.getByText("Thinking (5秒)")).toBeInTheDocument();

      // Advance time by 10 seconds — total elapsed should become 15秒.
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      expect(screen.getByText("Thinking (15秒)")).toBeInTheDocument();
    });

    it("promotes seconds to 分秒 format as time crosses 60s", () => {
      const fixedNow = new Date("2026-04-09T10:00:00.000Z").getTime();
      vi.setSystemTime(fixedNow);

      const meta: AgentEventMetadata = {
        agentEventType: "thinking",
        status: "running",
        startedAt: new Date(fixedNow - 55_000).toISOString(),
      };
      render(<TrackingEventItem metadata={meta} content="" isStreaming />);

      expect(screen.getByText("Thinking (55秒)")).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      expect(screen.getByText("Thinking (1分5秒)")).toBeInTheDocument();
    });

    it("does not start an interval when not streaming", () => {
      const setIntervalSpy = vi.spyOn(global, "setInterval");
      const meta: AgentEventMetadata = {
        agentEventType: "thinking",
        status: "completed",
        durationMs: 45_000,
      };
      render(<TrackingEventItem metadata={meta} content="" />);
      expect(setIntervalSpy).not.toHaveBeenCalled();
      setIntervalSpy.mockRestore();
    });

    it("does not start an interval while streaming without startedAt", () => {
      const setIntervalSpy = vi.spyOn(global, "setInterval");
      const meta: AgentEventMetadata = {
        agentEventType: "thinking",
        status: "running",
      };
      render(<TrackingEventItem metadata={meta} content="" isStreaming />);
      expect(setIntervalSpy).not.toHaveBeenCalled();
      setIntervalSpy.mockRestore();
    });

    it("clears its interval on unmount", () => {
      const fixedNow = new Date("2026-04-09T10:00:00.000Z").getTime();
      vi.setSystemTime(fixedNow);
      const clearIntervalSpy = vi.spyOn(global, "clearInterval");

      const meta: AgentEventMetadata = {
        agentEventType: "thinking",
        status: "running",
        startedAt: new Date(fixedNow - 1_000).toISOString(),
      };
      const { unmount } = render(
        <TrackingEventItem metadata={meta} content="" isStreaming />,
      );
      unmount();
      expect(clearIntervalSpy).toHaveBeenCalled();
      clearIntervalSpy.mockRestore();
    });

    it("renders bare Thinking while streaming if no elapsed yet", () => {
      const fixedNow = new Date("2026-04-09T10:00:00.000Z").getTime();
      vi.setSystemTime(fixedNow);

      const meta: AgentEventMetadata = {
        agentEventType: "thinking",
        status: "running",
        startedAt: new Date(fixedNow).toISOString(),
      };
      render(<TrackingEventItem metadata={meta} content="" isStreaming />);

      expect(screen.getByText("Thinking")).toBeInTheDocument();
    });
  });

  it("applies animate-pulse to the label while streaming", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "thinking",
      status: "running",
    };
    const { container } = render(
      <TrackingEventItem metadata={meta} content="" isStreaming />,
    );
    const label = container.querySelector(".animate-pulse.text-purple-400");
    expect(label).toBeInTheDocument();
  });

  it("keeps purple label color for completed thinking", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "thinking",
      status: "completed",
      totalTokens: 100,
    };
    const { container } = render(
      <TrackingEventItem metadata={meta} content="" />,
    );
    const label = container.querySelector(".text-purple-400");
    expect(label).toBeInTheDocument();
  });

  it("uses failed label color when thinking fails", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "thinking",
      status: "failed",
    };
    const { container } = render(
      <TrackingEventItem metadata={meta} content="" />,
    );
    // Failed thinking should use red-500 label color, not purple.
    const redLabel = container.querySelector(".text-red-500");
    expect(redLabel).toBeInTheDocument();
  });
});

describe("thinking regression — non-thinking events unaffected", () => {
  it("still shows dot and content for tool_result events", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "tool_result",
      status: "completed",
    };
    const { container } = render(
      <TrackingEventItem metadata={meta} content='{"ok": true}' collapsible />,
    );

    const dot = container.querySelector(".w-2.h-2.rounded-full");
    expect(dot).toBeInTheDocument();
    expect(screen.getByText("Result")).toBeInTheDocument();
  });

  it("does not start a live ticker for streaming non-thinking events", () => {
    const setIntervalSpy = vi.spyOn(global, "setInterval");
    const meta: AgentEventMetadata = {
      agentEventType: "writing",
      status: "running",
      // Shouldn't matter for non-thinking.
      startedAt: new Date().toISOString(),
    };
    render(<TrackingEventItem metadata={meta} content="..." isStreaming />);
    expect(setIntervalSpy).not.toHaveBeenCalled();
    setIntervalSpy.mockRestore();
  });

  it("does not force collapsible on non-thinking events", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "writing",
      status: "completed",
    };
    const { container } = render(
      <TrackingEventItem metadata={meta} content="written text" />,
    );
    // No chevron svg since collapsible is not set for writing events.
    const chevron = container.querySelector("svg");
    expect(chevron).not.toBeInTheDocument();
  });
});

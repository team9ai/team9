import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import i18n from "@/i18n";
import { changeLanguage } from "@/i18n/loadLanguage";
import {
  TrackingEventItem,
  formatDuration,
  buildThinkingStats,
} from "../TrackingEventItem";
import type { AgentEventMetadata } from "@/types/im";

// Use the real i18next instance so we exercise the en/zh JSON resources.
// Tests rely on the default "en" language; switch language per-test if needed.
const t = i18n.getFixedT("en", "channel");

beforeEach(async () => {
  if (i18n.language !== "en") {
    await i18n.changeLanguage("en");
  }
});

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
    expect(screen.getByText("Tool call completed")).toBeInTheDocument();
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

  it("pulses the icon yellow while running", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "writing",
      status: "running",
    };
    render(<TrackingEventItem metadata={meta} content="writing..." />);

    const icon = screen.getByTestId("event-icon");
    expect(icon).toHaveClass("animate-pulse");
    expect(icon).toHaveClass("text-yellow-400");
  });

  it("colors the icon red on failure", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "error",
      status: "failed",
    };
    render(<TrackingEventItem metadata={meta} content="Error occurred" />);

    const icon = screen.getByTestId("event-icon");
    expect(icon).toHaveClass("text-red-500");
    expect(icon).not.toHaveClass("animate-pulse");
    expect(screen.getByText("Error")).toBeInTheDocument();
  });

  it("pulses the icon yellow when isStreaming is true", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "writing",
      status: "completed", // status overridden by isStreaming
    };
    render(
      <TrackingEventItem metadata={meta} content="streaming..." isStreaming />,
    );

    // Streaming forces running status, so the icon pulses yellow
    // regardless of the underlying metadata.status value.
    const icon = screen.getByTestId("event-icon");
    expect(icon).toHaveClass("animate-pulse");
    expect(icon).toHaveClass("text-yellow-400");
  });

  it("should render all non-hidden event type labels correctly", () => {
    const eventTypes: Array<{
      type: AgentEventMetadata["agentEventType"];
      label: string;
    }> = [
      { type: "thinking", label: "Thinking" },
      { type: "writing", label: "Writing" },
      // tool_call uses getLabelKey -> tracking.ops.invokeTool.success (en)
      { type: "tool_call", label: "Tool call completed" },
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

  it("renders a distinct lucide icon per event type", () => {
    // The icon glyph is what tells the user which kind of event the row
    // is about — if the mapping silently regresses (all rows fall back
    // to the same icon) the visual language collapses. Asserting the
    // lucide class guards that contract.
    const cases: Array<{
      type: AgentEventMetadata["agentEventType"];
      iconClass: string;
    }> = [
      { type: "thinking", iconClass: "lucide-brain" },
      { type: "writing", iconClass: "lucide-pen-line" },
      { type: "tool_call", iconClass: "lucide-wrench" },
      { type: "tool_result", iconClass: "lucide-clipboard-list" },
      { type: "agent_start", iconClass: "lucide-play" },
      { type: "agent_end", iconClass: "lucide-flag" },
      { type: "error", iconClass: "lucide-circle-alert" },
      { type: "a2ui_surface_update", iconClass: "lucide-list" },
      { type: "a2ui_response", iconClass: "lucide-mouse-pointer-click" },
    ];

    for (const { type, iconClass } of cases) {
      const { unmount } = render(
        <TrackingEventItem
          metadata={{ agentEventType: type, status: "completed" }}
          content="test"
        />,
      );
      const icon = screen.getByTestId("event-icon");
      expect(icon).toHaveClass(iconClass);
      unmount();
    }
  });

  it("maps every status to its status color on the icon", () => {
    // Parallels LABEL_CLASSES — running→yellow (pulsing), completed/
    // resolved→emerald, failed/cancelled→red, timeout→amber. Guards
    // against accidental palette drift.
    const cases: Array<{
      status: AgentEventMetadata["status"];
      colorClass: string;
      pulses: boolean;
    }> = [
      { status: "running", colorClass: "text-yellow-400", pulses: true },
      { status: "completed", colorClass: "text-emerald-500", pulses: false },
      { status: "resolved", colorClass: "text-emerald-500", pulses: false },
      { status: "failed", colorClass: "text-red-500", pulses: false },
      { status: "cancelled", colorClass: "text-red-500", pulses: false },
      { status: "timeout", colorClass: "text-amber-500", pulses: false },
    ];

    for (const { status, colorClass, pulses } of cases) {
      const { unmount } = render(
        <TrackingEventItem
          metadata={{ agentEventType: "writing", status }}
          content="test"
        />,
      );
      const icon = screen.getByTestId("event-icon");
      expect(icon).toHaveClass(colorClass);
      if (pulses) {
        expect(icon).toHaveClass("animate-pulse");
      } else {
        expect(icon).not.toHaveClass("animate-pulse");
      }
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

  describe("tool_call label mapping via getLabelKey", () => {
    it("should use localized loading label for known tool with running status", () => {
      const meta: AgentEventMetadata = {
        agentEventType: "tool_call",
        status: "running",
        toolName: "send_message",
      };
      render(<TrackingEventItem metadata={meta} content="" />);
      expect(screen.getByText("Sending message")).toBeInTheDocument();
    });

    it("should use localized success label for known tool with completed status", () => {
      const meta: AgentEventMetadata = {
        agentEventType: "tool_call",
        status: "completed",
        toolName: "send_message",
      };
      render(<TrackingEventItem metadata={meta} content="" />);
      expect(screen.getByText("Message sent")).toBeInTheDocument();
    });

    it("should use localized error label for known tool with failed status", () => {
      const meta: AgentEventMetadata = {
        agentEventType: "tool_call",
        status: "failed",
        toolName: "send_message",
      };
      render(<TrackingEventItem metadata={meta} content="" />);
      expect(screen.getByText("Failed to send message")).toBeInTheDocument();
    });

    it("should treat resolved status as success for tool_call labels", () => {
      const meta: AgentEventMetadata = {
        agentEventType: "tool_call",
        status: "resolved",
        toolName: "search_docs",
      };
      render(<TrackingEventItem metadata={meta} content="" />);
      expect(screen.getByText("Documents found")).toBeInTheDocument();
    });

    it("should treat timeout status as error for tool_call labels", () => {
      const meta: AgentEventMetadata = {
        agentEventType: "tool_call",
        status: "timeout",
        toolName: "generate_reply",
      };
      render(<TrackingEventItem metadata={meta} content="" />);
      expect(screen.getByText("Reply generation failed")).toBeInTheDocument();
    });

    it("should treat cancelled status as error for tool_call labels", () => {
      const meta: AgentEventMetadata = {
        agentEventType: "tool_call",
        status: "cancelled",
        toolName: "send_message",
      };
      render(<TrackingEventItem metadata={meta} content="" />);
      expect(screen.getByText("Failed to send message")).toBeInTheDocument();
    });

    it("should force loading label when isStreaming overrides status", () => {
      const meta: AgentEventMetadata = {
        agentEventType: "tool_call",
        status: "completed", // isStreaming should flip this to running -> loading
        toolName: "send_message",
      };
      render(<TrackingEventItem metadata={meta} content="" isStreaming />);
      expect(screen.getByText("Sending message")).toBeInTheDocument();
      expect(screen.queryByText("Message sent")).not.toBeInTheDocument();
    });

    it("should fall back to operation-type label for unknown tool names", () => {
      const meta: AgentEventMetadata = {
        agentEventType: "tool_call",
        status: "running",
        toolName: "UnknownCustomTool",
      };
      render(<TrackingEventItem metadata={meta} content="" />);
      expect(screen.getByText("Calling tool")).toBeInTheDocument();
    });

    it("should fall back to operation-type label when toolName is missing", () => {
      const meta: AgentEventMetadata = {
        agentEventType: "tool_call",
        status: "completed",
      };
      render(<TrackingEventItem metadata={meta} content="fallback content" />);
      expect(screen.getByText("Tool call completed")).toBeInTheDocument();
    });

    it("should not apply getLabelKey to non-tool_call events", () => {
      // thinking events should retain the original EVENT_LABELS mapping
      render(
        <TrackingEventItem
          metadata={{ agentEventType: "thinking", status: "completed" }}
          content="Deep thought"
        />,
      );
      expect(screen.getByText("Thinking")).toBeInTheDocument();
      expect(screen.queryByText("Tool call completed")).not.toBeInTheDocument();
    });

    it("should honour the active language (zh-CN) for tool_call labels", async () => {
      await act(async () => {
        await changeLanguage("zh-CN");
      });
      try {
        const meta: AgentEventMetadata = {
          agentEventType: "tool_call",
          status: "completed",
          toolName: "send_message",
        };
        render(<TrackingEventItem metadata={meta} content="" />);
        expect(screen.getByText("消息发送完成")).toBeInTheDocument();
      } finally {
        await act(async () => {
          await i18n.changeLanguage("en");
        });
      }
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

  it("colors the icon by status but keeps the label a muted gray", () => {
    // The visual hierarchy splits signal across the row: icon carries
    // the status color so completion/failure reads at a glance, while
    // the label stays a neutral gray so it doesn't compete with the
    // content on the right.
    const meta: AgentEventMetadata = {
      agentEventType: "thinking",
      status: "completed",
    };
    render(<TrackingEventItem metadata={meta} content="thinking..." />);

    const icon = screen.getByTestId("event-icon");
    const label = screen.getByText("Thinking");
    expect(icon).toHaveClass("text-emerald-500");
    expect(label).toHaveClass("text-foreground/70");
    // Old special-case label colors must not leak back in.
    expect(label).not.toHaveClass("text-zinc-400");
    expect(label).not.toHaveClass("text-purple-400");
    expect(label).not.toHaveClass("text-emerald-500");
  });
});

describe("formatDuration helper", () => {
  it("formats sub-minute durations in seconds", () => {
    expect(formatDuration(45_000, t)).toBe("45s");
  });

  it("formats exactly 59 seconds without promoting to minutes", () => {
    expect(formatDuration(59_999, t)).toBe("59s");
  });

  it("formats exactly 60 seconds as 1m 0s", () => {
    expect(formatDuration(60_000, t)).toBe("1m 0s");
  });

  it("formats >= 60 seconds as minutes/seconds format", () => {
    expect(formatDuration(123_000, t)).toBe("2m 3s");
  });

  it("formats whole minutes with 0s suffix", () => {
    expect(formatDuration(120_000, t)).toBe("2m 0s");
  });

  it("floors millisecond values to whole seconds", () => {
    expect(formatDuration(45_999, t)).toBe("45s");
  });

  it("clamps negative values to 0s", () => {
    expect(formatDuration(-5_000, t)).toBe("0s");
  });

  it("returns 0s for zero", () => {
    expect(formatDuration(0, t)).toBe("0s");
  });

  it("honours the zh-CN locale when translating", async () => {
    await changeLanguage("zh-CN");
    const zhT = i18n.getFixedT("zh-CN", "channel");
    expect(formatDuration(45_000, zhT)).toBe("45 秒");
    expect(formatDuration(123_000, zhT)).toBe("2 分 3 秒");
  });
});

describe("buildThinkingStats helper", () => {
  it("returns bare Thinking when no stats available", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "thinking",
      status: "completed",
    };
    expect(buildThinkingStats(meta, false, t)).toBe("Thinking");
  });

  it("ignores tokens entirely (not shown in the label)", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "thinking",
      status: "completed",
      totalTokens: 1200,
      outputTokens: 800,
    };
    // Token counts are intentionally omitted from the label regardless
    // of totalTokens/outputTokens values.
    expect(buildThinkingStats(meta, false, t)).toBe("Thinking");
  });

  it("uses 'Thought for' wording when completed with duration", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "thinking",
      status: "completed",
      durationMs: 123_000,
    };
    expect(buildThinkingStats(meta, false, t)).toBe("Thought for 2m 3s");
  });

  it("shows only duration when both tokens and duration are present", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "thinking",
      status: "completed",
      totalTokens: 1200,
      durationMs: 123_000,
    };
    expect(buildThinkingStats(meta, false, t)).toBe("Thought for 2m 3s");
  });

  it("uses 'Thinking' (present tense) while streaming with elapsed", () => {
    const now = 1_700_000_000_000;
    const started = new Date(now - 45_000).toISOString();
    const meta: AgentEventMetadata = {
      agentEventType: "thinking",
      status: "running",
      startedAt: started,
    };
    expect(buildThinkingStats(meta, true, t, now)).toBe("Thinking 45s");
  });

  it("shows live elapsed only (ignoring tokens) while streaming", () => {
    const now = 2_000_000_000_000;
    const started = new Date(now - 30_000).toISOString();
    const meta: AgentEventMetadata = {
      agentEventType: "thinking",
      status: "running",
      totalTokens: 300,
      startedAt: started,
    };
    expect(buildThinkingStats(meta, true, t, now)).toBe("Thinking 30s");
  });

  it("omits live elapsed when startedAt is invalid", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "thinking",
      status: "running",
      startedAt: "not-a-date",
    };
    expect(buildThinkingStats(meta, true, t, Date.now())).toBe("Thinking");
  });

  it("falls back to bare Thinking when startedAt missing while streaming", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "thinking",
      status: "running",
      totalTokens: 10,
    };
    // Without startedAt there's no elapsed to show, and tokens are
    // intentionally not surfaced — so the label stays bare.
    expect(buildThinkingStats(meta, true, t, Date.now())).toBe("Thinking");
  });

  it("shows 0s label at same-instant start (no initial-second gap)", () => {
    // Regression: we used to hide the duration for the first second,
    // so the label flickered "Thinking" → "Thinking 1s". Now the
    // duration renders from 0s so the row is stable from the start.
    const now = 1_700_000_000_000;
    const meta: AgentEventMetadata = {
      agentEventType: "thinking",
      status: "running",
      startedAt: new Date(now).toISOString(),
    };
    expect(buildThinkingStats(meta, true, t, now)).toBe("Thinking 0s");
  });

  it("clamps negative elapsed (clock skew) to 0s while streaming", () => {
    // If startedAt is in the future (e.g. slight server/client clock
    // drift) we clamp to 0s rather than emitting a bare label or a
    // negative duration.
    const now = 1_700_000_000_000;
    const started = new Date(now + 3_000).toISOString();
    const meta: AgentEventMetadata = {
      agentEventType: "thinking",
      status: "running",
      startedAt: started,
    };
    expect(buildThinkingStats(meta, true, t, now)).toBe("Thinking 0s");
  });

  it("ignores startedAt when not streaming", () => {
    // Once streaming ends the caller owns the final durationMs; any
    // lingering startedAt is ignored so we don't race against the clock.
    const meta: AgentEventMetadata = {
      agentEventType: "thinking",
      status: "completed",
      startedAt: new Date(0).toISOString(),
    };
    expect(buildThinkingStats(meta, false, t, Date.now())).toBe("Thinking");
  });

  it("prefers durationMs over startedAt when not streaming", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "thinking",
      status: "completed",
      durationMs: 45_000,
      startedAt: new Date(0).toISOString(),
    };
    expect(buildThinkingStats(meta, false, t, Date.now())).toBe(
      "Thought for 45s",
    );
  });

  it("honours the zh-CN locale for completed wording", async () => {
    await changeLanguage("zh-CN");
    const zhT = i18n.getFixedT("zh-CN", "channel");
    const meta: AgentEventMetadata = {
      agentEventType: "thinking",
      status: "completed",
      totalTokens: 1200,
      durationMs: 123_000,
    };
    expect(buildThinkingStats(meta, false, zhT)).toBe("思考用时 2 分 3 秒");
  });

  it("honours the zh-CN locale for streaming wording", async () => {
    await changeLanguage("zh-CN");
    const zhT = i18n.getFixedT("zh-CN", "channel");
    const now = 1_700_000_000_000;
    const meta: AgentEventMetadata = {
      agentEventType: "thinking",
      status: "running",
      startedAt: new Date(now - 45_000).toISOString(),
    };
    expect(buildThinkingStats(meta, true, zhT, now)).toBe("思考中 45 秒");
  });
});

describe("thinking event display", () => {
  it("renders a solid emerald icon for completed thinking (no pulse)", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "thinking",
      status: "completed",
    };
    render(<TrackingEventItem metadata={meta} content="Deep thought" />);

    const icon = screen.getByTestId("event-icon");
    expect(icon).toHaveClass("text-emerald-500");
    expect(icon).not.toHaveClass("animate-pulse");
    // Regression: no leftover dot element (the old w-2 h-2 swatch is gone).
    expect(
      icon.ownerDocument.querySelector(".w-2.h-2.rounded-full"),
    ).not.toBeInTheDocument();
  });

  it("pulses a yellow icon while streaming thinking", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "thinking",
      status: "running",
    };
    render(<TrackingEventItem metadata={meta} content="" isStreaming />);
    const icon = screen.getByTestId("event-icon");
    expect(icon).toHaveClass("text-yellow-400");
    expect(icon).toHaveClass("animate-pulse");
  });

  it("renders an icon for non-thinking events (regression)", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "writing",
      status: "completed",
    };
    render(<TrackingEventItem metadata={meta} content="writing..." />);

    expect(screen.getByTestId("event-icon")).toBeInTheDocument();
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

    // Chevron is rendered. Both the event icon and the chevron are SVGs,
    // so we target the chevron by its lucide class name.
    expect(
      container.querySelector(".lucide-chevron-right"),
    ).toBeInTheDocument();
    // And the main row should carry the cursor-pointer class.
    expect(container.querySelector(".cursor-pointer")).toBeInTheDocument();
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

  it("shows only duration when both tokens and duration are present", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "thinking",
      status: "completed",
      totalTokens: 1200,
      durationMs: 123_000,
    };
    render(<TrackingEventItem metadata={meta} content="" />);

    // Tokens are hidden by design — only the duration surfaces.
    expect(screen.getByText("Thought for 2m 3s")).toBeInTheDocument();
    expect(screen.queryByText(/1200 tokens/)).not.toBeInTheDocument();
  });

  it("falls back to bare Thinking when only tokens are present (tokens hidden)", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "thinking",
      status: "completed",
      totalTokens: 1200,
    };
    render(<TrackingEventItem metadata={meta} content="" />);

    expect(screen.getByText("Thinking")).toBeInTheDocument();
    expect(screen.queryByText(/1200 tokens/)).not.toBeInTheDocument();
  });

  it("shows duration-only label when tokens missing", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "thinking",
      status: "completed",
      durationMs: 123_000,
    };
    render(<TrackingEventItem metadata={meta} content="" />);

    expect(screen.getByText("Thought for 2m 3s")).toBeInTheDocument();
  });

  it("shows bare Thinking label when nothing is available", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "thinking",
      status: "completed",
    };
    render(<TrackingEventItem metadata={meta} content="" />);

    expect(screen.getByText("Thinking")).toBeInTheDocument();
  });

  it("formats sub-minute durations in seconds", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "thinking",
      status: "completed",
      durationMs: 45_000,
    };
    render(<TrackingEventItem metadata={meta} content="" />);

    expect(screen.getByText("Thought for 45s")).toBeInTheDocument();
  });

  it("formats durations >= 60s with minutes and seconds", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "thinking",
      status: "completed",
      durationMs: 125_000,
    };
    render(<TrackingEventItem metadata={meta} content="" />);

    expect(screen.getByText("Thought for 2m 5s")).toBeInTheDocument();
  });

  it("formats whole minutes as 2m 0s", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "thinking",
      status: "completed",
      durationMs: 120_000,
    };
    render(<TrackingEventItem metadata={meta} content="" />);

    expect(screen.getByText("Thought for 2m 0s")).toBeInTheDocument();
  });

  it("expands on click and shows metadata.thinking body", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "thinking",
      status: "completed",
      durationMs: 1_000,
      thinking: "Metadata thinking body takes precedence",
    };
    render(<TrackingEventItem metadata={meta} content="content fallback" />);

    fireEvent.click(screen.getByText("Thought for 1s"));
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
      expect(screen.getByText("Thinking 5s")).toBeInTheDocument();

      // Advance time by 10 seconds — total elapsed should become 15s.
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      expect(screen.getByText("Thinking 15s")).toBeInTheDocument();
    });

    it("promotes seconds to m/s format as time crosses 60s", () => {
      const fixedNow = new Date("2026-04-09T10:00:00.000Z").getTime();
      vi.setSystemTime(fixedNow);

      const meta: AgentEventMetadata = {
        agentEventType: "thinking",
        status: "running",
        startedAt: new Date(fixedNow - 55_000).toISOString(),
      };
      render(<TrackingEventItem metadata={meta} content="" isStreaming />);

      expect(screen.getByText("Thinking 55s")).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      expect(screen.getByText("Thinking 1m 5s")).toBeInTheDocument();
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

    it("renders 'Thinking 0s' immediately at streaming start", () => {
      // Regression: previously the label flickered "Thinking" (no
      // duration) at the same-instant start, then jumped to
      // "Thinking 1s" one tick later. Now it stabilizes at 0s from
      // the first render so the row doesn't reflow.
      const fixedNow = new Date("2026-04-09T10:00:00.000Z").getTime();
      vi.setSystemTime(fixedNow);

      const meta: AgentEventMetadata = {
        agentEventType: "thinking",
        status: "running",
        startedAt: new Date(fixedNow).toISOString(),
      };
      render(<TrackingEventItem metadata={meta} content="" isStreaming />);

      expect(screen.getByText("Thinking 0s")).toBeInTheDocument();
    });
  });

  it("pulses the gray label while streaming (alongside the icon)", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "thinking",
      status: "running",
    };
    render(<TrackingEventItem metadata={meta} content="" isStreaming />);
    // Both the icon (yellow) and the label (gray) pulse while thinking
    // is in flight so the row reads as clearly "active", not merely
    // "done in yellow".
    const icon = screen.getByTestId("event-icon");
    expect(icon).toHaveClass("animate-pulse", "text-yellow-400");
    // Label surfaces via buildThinkingStats; query by its starting text.
    const label = screen.getByText(/^Thinking/);
    expect(label).toHaveClass("animate-pulse", "text-foreground/70");
  });

  it("keeps the label gray for completed thinking", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "thinking",
      status: "completed",
      totalTokens: 100,
    };
    render(<TrackingEventItem metadata={meta} content="" />);
    const label = screen.getByText("Thinking");
    expect(label).toHaveClass("text-foreground/70");
    expect(label).not.toHaveClass("animate-pulse");
  });

  it("turns the label red on failure", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "thinking",
      status: "failed",
    };
    render(<TrackingEventItem metadata={meta} content="" />);
    const label = screen.getByText("Thinking");
    expect(label).toHaveClass("text-red-500");
  });
});

describe("thinking regression — non-thinking events unaffected", () => {
  it("still shows icon and content for tool_result events", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "tool_result",
      status: "completed",
    };
    render(
      <TrackingEventItem metadata={meta} content='{"ok": true}' collapsible />,
    );

    expect(screen.getByTestId("event-icon")).toBeInTheDocument();
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
    // No chevron since collapsible is not set for writing events.
    // (The event icon is still rendered — assert chevron-specifically.)
    expect(
      container.querySelector(".lucide-chevron-right"),
    ).not.toBeInTheDocument();
  });
});

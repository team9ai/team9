import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TrackingEventItem } from "../TrackingEventItem";
import type { AgentEventMetadata } from "@/types/im";

describe("TrackingEventItem", () => {
  it("should render label and content for a thinking event", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "thinking",
      status: "completed",
    };
    render(
      <TrackingEventItem metadata={meta} content="Analyzing the code..." />,
    );

    expect(screen.getByText("Thinking")).toBeInTheDocument();
    expect(screen.getByText("Analyzing the code...")).toBeInTheDocument();
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
      agentEventType: "thinking",
      status: "running",
    };
    const { container } = render(
      <TrackingEventItem metadata={meta} content="thinking..." />,
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

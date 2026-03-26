import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
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

  it("should render tool name instead of content for tool_call events", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "tool_call",
      status: "completed",
      toolName: "SearchFiles",
    };
    render(<TrackingEventItem metadata={meta} content="raw content" />);

    expect(screen.getByText("Calling")).toBeInTheDocument();
    expect(screen.getByText("SearchFiles")).toBeInTheDocument();
    expect(screen.queryByText("raw content")).not.toBeInTheDocument();
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

  it("should render all event type labels correctly", () => {
    const eventTypes: Array<{
      type: AgentEventMetadata["agentEventType"];
      label: string;
    }> = [
      { type: "thinking", label: "Thinking" },
      { type: "writing", label: "Writing" },
      { type: "tool_call", label: "Calling" },
      { type: "tool_result", label: "Result" },
      { type: "agent_start", label: "Started" },
      { type: "agent_end", label: "Completed" },
      { type: "error", label: "Error" },
      { type: "turn_separator", label: "Turn" },
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
});

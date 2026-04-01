import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ToolCallBlock } from "../ToolCallBlock";
import type { AgentEventMetadata } from "@/types/im";

function makeCallMeta(
  toolName: string,
  toolArgs?: Record<string, unknown>,
): AgentEventMetadata {
  return {
    agentEventType: "tool_call",
    status: "completed",
    toolName,
    toolCallId: "tc-1",
    toolArgs,
  };
}

function makeResultMeta(
  status: "completed" | "failed" = "completed",
): AgentEventMetadata {
  return {
    agentEventType: "tool_result",
    status,
    success: status === "completed",
    toolCallId: "tc-1",
  };
}

describe("ToolCallBlock", () => {
  it("renders tool name from call metadata", () => {
    render(
      <ToolCallBlock
        callMetadata={makeCallMeta("SearchFiles")}
        resultMetadata={makeResultMeta()}
        resultContent='{"found": true}'
      />,
    );

    expect(screen.getByText("Calling")).toBeInTheDocument();
    expect(screen.getByText("SearchFiles")).toBeInTheDocument();
  });

  it("shows tool name with args summary in collapsed state", () => {
    render(
      <ToolCallBlock
        callMetadata={makeCallMeta("QueryChannelInfo", {
          channelId: "ch-123",
        })}
        resultMetadata={makeResultMeta()}
        resultContent='{"name": "general"}'
      />,
    );

    expect(screen.getByText("QueryChannelInfo(ch-123)")).toBeInTheDocument();
  });

  it("shows success indicator (checkmark) for completed result", () => {
    render(
      <ToolCallBlock
        callMetadata={makeCallMeta("ReadFile")}
        resultMetadata={makeResultMeta("completed")}
        resultContent="file contents"
      />,
    );

    expect(screen.getByText("\u2714")).toBeInTheDocument();
  });

  it("shows failure indicator (cross) for failed result", () => {
    const { container } = render(
      <ToolCallBlock
        callMetadata={makeCallMeta("RunScript")}
        resultMetadata={makeResultMeta("failed")}
        resultContent="permission denied"
      />,
    );

    expect(screen.getByText("\u2718")).toBeInTheDocument();
    expect(container.querySelector(".bg-red-500")).toBeInTheDocument();
  });

  it("shows result summary when collapsed", () => {
    render(
      <ToolCallBlock
        callMetadata={makeCallMeta("Search")}
        resultMetadata={makeResultMeta()}
        resultContent="short result"
      />,
    );

    expect(screen.getByText("Result")).toBeInTheDocument();
    expect(screen.getByText("short result")).toBeInTheDocument();
  });

  it("truncates long result summary to 80 chars", () => {
    const longContent = "x".repeat(100);
    render(
      <ToolCallBlock
        callMetadata={makeCallMeta("Search")}
        resultMetadata={makeResultMeta()}
        resultContent={longContent}
      />,
    );

    expect(screen.getByText("x".repeat(80) + " ...")).toBeInTheDocument();
  });

  it("shows both args and result when expanded", () => {
    render(
      <ToolCallBlock
        callMetadata={makeCallMeta("QueryChannel", {
          channelId: "ch-456",
        })}
        resultMetadata={makeResultMeta()}
        resultContent='{"name": "general"}'
      />,
    );

    fireEvent.click(screen.getByText("Calling"));

    // Args section visible
    expect(screen.getByText("Args")).toBeInTheDocument();
    expect(screen.getByText(/"channelId": "ch-456"/)).toBeInTheDocument();

    // Result section visible
    expect(screen.getByText("Result")).toBeInTheDocument();
  });

  it("hides args section when no toolArgs provided", () => {
    render(
      <ToolCallBlock
        callMetadata={makeCallMeta("SimpleTool")}
        resultMetadata={makeResultMeta()}
        resultContent="done"
      />,
    );

    fireEvent.click(screen.getByText("Calling"));

    expect(screen.queryByText("Args")).not.toBeInTheDocument();
    expect(screen.getByText("Result")).toBeInTheDocument();
  });

  it("collapses back to summary on second click", () => {
    render(
      <ToolCallBlock
        callMetadata={makeCallMeta("Search")}
        resultMetadata={makeResultMeta()}
        resultContent="toggle content"
      />,
    );

    const label = screen.getByText("Calling");

    // Expand
    fireEvent.click(label);
    // Collapse
    fireEvent.click(label);
    expect(screen.getByText("Result")).toBeInTheDocument();
    expect(screen.getByText("toggle content")).toBeInTheDocument();
  });

  it("falls back to 'Unknown tool' when toolName is missing", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "tool_call",
      status: "completed",
      toolCallId: "tc-1",
    };
    render(
      <ToolCallBlock
        callMetadata={meta}
        resultMetadata={makeResultMeta()}
        resultContent="result"
      />,
    );

    expect(screen.getByText("Unknown tool")).toBeInTheDocument();
  });

  it("uses green status dot for successful result", () => {
    const { container } = render(
      <ToolCallBlock
        callMetadata={makeCallMeta("Tool")}
        resultMetadata={makeResultMeta("completed")}
        resultContent="ok"
      />,
    );

    expect(container.querySelector(".bg-emerald-500")).toBeInTheDocument();
    expect(container.querySelector(".bg-red-500")).not.toBeInTheDocument();
  });

  it("unwraps nested content structure in tool results", () => {
    const wrappedContent = JSON.stringify({
      content: [{ type: "text", text: '{"success":true}' }],
      details: {},
    });

    render(
      <ToolCallBlock
        callMetadata={makeCallMeta("ReportSteps")}
        resultMetadata={makeResultMeta()}
        resultContent={wrappedContent}
      />,
    );

    // Summary should show unwrapped content, not the wrapper
    expect(screen.getByText('{"success":true}')).toBeInTheDocument();
  });
});
